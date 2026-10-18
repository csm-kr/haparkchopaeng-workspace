/**
 * Real Electron Tray/Menu regression with an owned temporary bootstrap/profile.
 * No Playwright, CDP, product main/renderer, accounts, CLI or protocol handlers.
 * Run with desktop dependencies, or --dependencies-root=<another checkout>.
 * Linux needs a display; a constructed Tray does not prove a visible host.
 */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const connectorRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const option = process.argv.slice(2);
assert.ok(option.length <= 1 && option.every(value => value.startsWith('--dependencies-root=')), 'Use only --dependencies-root=<checkout>.');
const dependenciesRoot = resolve(option[0]?.slice('--dependencies-root='.length) || dirname(connectorRoot));
const platform = ({ win32: 'windows', darwin: 'macos', linux: 'linux' })[process.platform];
assert.ok(platform, 'Native tray QA supports Windows, macOS and Linux.');

const qaDirectory = await mkdtemp(join(tmpdir(), 'hapark-native-tray-'));
const profile = join(qaDirectory, 'profile');
const sessionDirectory = join(qaDirectory, 'session');
const logsDirectory = join(qaDirectory, 'logs');
await Promise.all([profile, sessionDirectory, logsDirectory].map(path => mkdir(path, { mode: 0o700 })));
const proofFile = join(qaDirectory, 'native-proof.json');
const evidenceDirectory = join(connectorRoot, 'artifacts', `desktop-tray-${platform}`);
await mkdir(evidenceDirectory, { recursive: true });
const qaId = randomUUID();
const evidence = {
  passed: false, platform, architecture: process.arch, capturedAt: new Date().toISOString(),
  mode: 'unpackaged-real-electron-tray-and-menu', checks: [],
  visibleWindowRequested: false, focusRequested: false, productMainImported: false,
  productRendererLoaded: false, protocolRegistrationRequested: false, cliRequests: 0, inferenceRequests: 0,
  limits: [
    'MenuItem callbacks are invoked on real Electron menu items without displaying a menu or clicking the OS tray.',
    'This does not verify packaged installation, production main wiring, account pairing or a visible Linux indicator host.',
    'Electron window visibility/focus is observed; other applications and OS foreground focus are not queried.',
    'No product renderer or account runtime is loaded; there is no independent machine-wide network monitor.',
    'A temporary QA preload observes Electron sandbox/context isolation; OS sandbox enforcement belongs to the existing installed smoke.',
  ],
};
const execute = promisify(execFile);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let child, closed = false, exitCode = null, exitSignal = null, spawnError, forcedCleanup = false;
let failure, phase = 'dependency_preflight';
let interrupted = false;
const interrupt = () => { interrupted = true; };
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

async function until(predicate, code, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw Object.assign(new Error(code), { code });
}
function inside(path, parent) {
  const part = relative(parent, path);
  assert.ok(part && !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`), 'Expected owned descendant path.');
}
async function hash(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }
async function stopOwned() {
  if (!child?.pid || closed) return;
  forcedCleanup = true;
  if (process.platform === 'win32') {
    await execute(join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, timeout: 10_000 }).catch(() => {});
  } else {
    // detached below creates only this child's process group.
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await delay(300);
    if (!closed) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  }
  await until(() => closed, 'OWNED_CHILD_CLEANUP_INCOMPLETE', 10_000);
}

try {
  const desktop = join(connectorRoot, 'desktop');
  const pkg = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8'));
  const electronPackage = join(dependenciesRoot, 'connector', 'desktop', 'node_modules', 'electron');
  const installedElectron = JSON.parse(await readFile(join(electronPackage, 'package.json'), 'utf8'));
  assert.equal(installedElectron.version, pkg.devDependencies.electron, 'Use the checkout Electron version.');
  // Do not require('electron'): Electron 44 may download its runtime on require.
  const runtimeRelative = (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim();
  assert.ok(runtimeRelative && !isAbsolute(runtimeRelative), 'Prepare the official Electron runtime first.');
  const electron = await realpath(join(electronPackage, 'dist', runtimeRelative));
  inside(electron, await realpath(join(electronPackage, 'dist')));
  await access(electron);
  const modulePath = join(desktop, 'tray.mjs');
  const trayIcon = join(desktop, 'assets', 'tray.png');
  const templateIcon = join(desktop, 'assets', 'trayTemplate.png');
  evidence.source = { traySha256: await hash(modulePath), trayIconSha256: await hash(trayIcon), templateIconSha256: await hash(templateIcon) };
  evidence.runtime = { electron: installedElectron.version, productName: pkg.productName, version: pkg.version };
  const preloadFile = join(qaDirectory, 'isolation-preload.cjs');
  const blankFile = join(qaDirectory, 'blank.html');
  const isolationChannel = `native-tray-qa-${qaId}`;
  await writeFile(preloadFile, `const { ipcRenderer } = require('electron');
ipcRenderer.send(${JSON.stringify(isolationChannel)}, { sandboxed: process.sandboxed === true, contextIsolated: process.contextIsolated === true });
`, { mode: 0o600 });
  await writeFile(blankFile, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title>Native tray QA</title>', { mode: 0o600 });
  const configuration = { qaId, proofFile, profile, sessionDirectory, logsDirectory,
    moduleUrl: pathToFileURL(modulePath).href, trayIcon, templateIcon, productName: pkg.productName,
    missingIcon: join(qaDirectory, 'missing-tray.png'), preloadFile, blankFile, isolationChannel };
  const bootstrap = join(qaDirectory, 'tray-bootstrap.mjs');
  await writeFile(bootstrap, `
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { app, BrowserWindow, Menu, MenuItem, Tray, nativeImage, session, ipcMain } from 'electron';
const config = ${JSON.stringify(configuration)};
app.setName('hapark-native-tray-qa');
app.setPath('userData', config.profile);
app.setPath('sessionData', config.sessionDirectory);
app.setPath('logs', config.logsDirectory);
if (process.platform === 'darwin') app.setActivationPolicy('accessory');
const controls = [], nativeTrays = [], menus = [];
let window, isolation, networkRequests = 0, openCalls = 0, quitCalls = 0, stage = 'ready';
function dispose() { for (const controller of controls) controller.dispose(); }
async function verifyTray() {
  const { createConnectorTray, shouldHideWindowToTray } = await import(config.moduleUrl);
  const checks = [];
  stage = 'image_decode';
  const template = nativeImage.createFromPath(config.templateIcon);
  const icon = nativeImage.createFromPath(config.trayIcon);
  assert.equal(template.isEmpty(), false, 'Template icon must decode.');
  assert.equal(icon.isEmpty(), false, 'Tray icon must decode.');
  checks.push('actual-native-images-decode');
  const captures = { Tray: function CaptureTray(image) {
    const instance = new Tray(image); nativeTrays.push({ instance, image }); return instance;
  }, Menu: { buildFromTemplate(template) {
    const menu = Menu.buildFromTemplate(template); menus.push(menu); return menu;
  } }, nativeImage };
  stage = 'native_tray_create';
  const controller = createConnectorTray({ ...captures, platform: process.platform,
    productName: config.productName, iconPath: process.platform === 'darwin' ? config.templateIcon : config.trayIcon,
    onOpen: () => { openCalls += 1; }, onQuit: () => { quitCalls += 1; } });
  controls.push(controller);
  const actualTrayCreated = controller.available;
  if (process.platform !== 'linux') assert.equal(actualTrayCreated, true, 'Windows/macOS must create a real Tray.');
  let templateImageApplied = null;
  if (actualTrayCreated) {
    const native = nativeTrays[0];
    assert.ok(native.instance instanceof Tray);
    const size = process.platform === 'darwin' ? 18 : 32;
    assert.deepEqual(native.image.getSize(), { width: size, height: size });
    if (process.platform === 'darwin') { templateImageApplied = native.image.isTemplateImage(); assert.equal(templateImageApplied, true); }
    const initialMenu = menus.at(-1);
    assert.ok(initialMenu instanceof Menu);
    assert.deepEqual(initialMenu.items.filter(item => item.type !== 'separator').map(item => item.label),
      [config.productName, '연결 대기', config.productName + ' 열기', config.productName + ' 종료']);
    checks.push('actual-tray-and-native-menu-created');
    stage = 'state_updates';
    for (const [state, label] of [['connected', '연결됨'], ['recovering', '연결 복구 중'], ['authorization_required', '연결 중단']]) {
      assert.equal(controller.updateStage(state), true);
      assert.equal(menus.at(-1).items[1].label, label);
    }
    assert.equal(openCalls, 0); assert.equal(quitCalls, 0);
    checks.push('native-menu-follows-connection-state-without-opening');
    stage = 'menuitem_callbacks';
    const menu = menus.at(-1);
    const open = menu.items.find(item => item.label === config.productName + ' 열기');
    const quit = menu.items.find(item => item.label === config.productName + ' 종료');
    assert.ok(open instanceof MenuItem); assert.ok(quit instanceof MenuItem);
    assert.equal(open.enabled, true); assert.equal(quit.enabled, true);
    open.click(open, window, {}); assert.equal(openCalls, 1);
    quit.click(quit, window, {}); quit.click(quit, window, {});
    assert.equal(quitCalls, 1);
    open.click(open, window, {}); assert.equal(openCalls, 1);
    assert.equal(menus.at(-1).items[1].label, '종료 중');
    assert.ok(menus.at(-1).items.filter(item => typeof item.click === 'function' && item.type !== 'separator').every(item => !item.enabled));
    checks.push('actual-menuitem-open-quit-callbacks-and-duplicate-quit-guard');
    stage = 'dispose';
    controller.dispose(); controller.dispose();
    assert.equal(native.instance.isDestroyed(), true);
    assert.equal(native.instance.listenerCount('click'), 0);
    assert.equal(controller.available, false);
    assert.equal(controller.updateStage('connected'), false);
    open.click(open, window, {}); quit.click(quit, window, {});
    assert.equal(openCalls, 1); assert.equal(quitCalls, 1);
    checks.push('dispose-destroys-native-tray-and-stale-callbacks-stay-inert');
  } else {
    assert.equal(controller.updateStage('connected'), false);
    controller.dispose(); controller.dispose();
    checks.push('linux-unavailable-tray-keeps-window-fallback');
  }
  stage = 'unavailable_fallback';
  const fallback = createConnectorTray({ ...captures, platform: process.platform,
    productName: config.productName, iconPath: config.missingIcon,
    onOpen() { throw new Error('Unavailable tray must not open.'); }, onQuit() { throw new Error('Unavailable tray must not quit.'); } });
  controls.push(fallback);
  assert.equal(fallback.available, false);
  assert.equal(shouldHideWindowToTray({ platform: process.platform, authorized: true, trayAvailable: fallback.available, quitting: false }), false);
  fallback.dispose(); fallback.dispose();
  if (process.platform === 'linux') {
    for (const trayAvailable of [false, true]) assert.equal(shouldHideWindowToTray({ platform: 'linux', authorized: true, trayAvailable, quitting: false }), false);
  }
  checks.push('missing-native-image-never-authorizes-hidden-window');
  stage = 'hidden_sandboxed_window';
  assert.equal(window.isVisible(), false); assert.equal(window.isFocused(), false);
  assert.equal(BrowserWindow.getFocusedWindow(), null);
  assert.equal(window.webContents.isOffscreen(), true);
  assert.equal(isolation.sandboxed, true); assert.equal(isolation.contextIsolated, true);
  assert.equal(await window.webContents.executeJavaScript("typeof window.require === 'undefined' && typeof window.process === 'undefined'"), true);
  assert.equal(networkRequests, 0);
  assert.ok(nativeTrays.every(value => value.instance.isDestroyed()));
  checks.push('offscreen-sandbox-config-hidden-unfocused-zero-renderer-network');
  return { checks, actualTrayCreated, templateImageApplied, openCalls, quitCalls,
    allNativeTraysDestroyed: true, rendererSandboxObserved: true, rendererContextIsolationObserved: true,
    linuxHideAllowed: process.platform === 'linux' ? false : null,
    windowVisible: window.isVisible(), windowFocused: window.isFocused(), rendererNetworkRequests: networkRequests };
}
void app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => {
    networkRequests += 1; callback({ cancel: true });
  });
  const isolationReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ipcMain.removeAllListeners(config.isolationChannel); reject(new Error('QA isolation observation timed out.')); }, 10000);
    ipcMain.once(config.isolationChannel, (event, value) => {
      clearTimeout(timeout);
      if (event.sender !== window.webContents || typeof value?.sandboxed !== 'boolean' || typeof value?.contextIsolated !== 'boolean') reject(new Error('Unexpected QA isolation observation.'));
      else resolve(value);
    });
  });
  window = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: config.preloadFile } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const [, observedIsolation] = await Promise.all([window.loadFile(config.blankFile), isolationReady]);
  isolation = observedIsolation;
  window.webContents.on('will-navigate', event => event.preventDefault());
  assert.equal(window.isVisible(), false); assert.equal(window.isFocused(), false);
  const native = await verifyTray();
  await writeFile(config.proofFile, JSON.stringify({ qaId: config.qaId, passed: true, pid: process.pid,
    platform: process.platform, architecture: process.arch, electron: process.versions.electron, native }));
  app.quit();
}).catch(async error => {
  try { dispose(); } catch {}
  await writeFile(config.proofFile, JSON.stringify({ qaId: config.qaId, passed: false, pid: process.pid,
    failedStage: stage, errorCode: error instanceof assert.AssertionError ? 'NATIVE_TRAY_ASSERTION_FAILED' : 'NATIVE_TRAY_RUNTIME_FAILED' })).catch(() => {});
  app.exit(1);
});
app.on('before-quit', dispose);
`, { mode: 0o600 });
  phase = 'electron_launch';
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  if (interrupted) throw Object.assign(new Error('QA interrupted.'), { code: 'QA_INTERRUPTED' });
  const stdout = await open(join(logsDirectory, 'electron.out.log'), 'wx');
  const stderr = await open(join(logsDirectory, 'electron.err.log'), 'wx');
  try {
    child = spawn(electron, [bootstrap, '--connector-qa', '--connector-dev', '--no-auto-open', `--user-data-dir=${profile}`],
      { cwd: qaDirectory, windowsHide: true, shell: false, detached: process.platform !== 'win32', env, stdio: ['ignore', stdout.fd, stderr.fd] });
    child.once('error', error => { spawnError = error; });
    child.once('close', (code, signal) => { closed = true; exitCode = code; exitSignal = signal; });
  } finally { await stdout.close(); await stderr.close(); }
  phase = 'native_tray_and_normal_quit';
  await until(() => {
    if (interrupted) throw Object.assign(new Error('QA interrupted.'), { code: 'QA_INTERRUPTED' });
    return closed;
  }, 'ELECTRON_TRAY_TIMEOUT', 45_000);
  if (spawnError) throw spawnError;
  const rawProof = await readFile(proofFile, 'utf8');
  assert.ok(rawProof.length < 32_768, 'Unexpected proof size.');
  const proof = JSON.parse(rawProof);
  assert.equal(proof.qaId, qaId); assert.equal(proof.pid, child.pid);
  if (!proof.passed) {
    evidence.nativeFailedStage = /^[a-z_]{1,64}$/.test(proof.failedStage) ? proof.failedStage : 'unknown';
    throw Object.assign(new Error('Native tray assertions failed.'), {
      code: ['NATIVE_TRAY_ASSERTION_FAILED', 'NATIVE_TRAY_RUNTIME_FAILED'].includes(proof.errorCode) ? proof.errorCode : 'NATIVE_TRAY_FAILED',
    });
  }
  assert.equal(proof.passed, true);
  assert.equal(proof.platform, process.platform); assert.equal(proof.architecture, process.arch);
  assert.equal(proof.electron, installedElectron.version);
  assert.equal(exitCode, 0); assert.equal(exitSignal, null);
  assert.equal(proof.native.allNativeTraysDestroyed, true);
  assert.equal(proof.native.windowVisible, false); assert.equal(proof.native.windowFocused, false);
  assert.equal(proof.native.rendererSandboxObserved, true); assert.equal(proof.native.rendererContextIsolationObserved, true);
  assert.equal(proof.native.rendererNetworkRequests, 0);
  if (process.platform !== 'linux') assert.equal(proof.native.actualTrayCreated, true);
  assert.ok(Array.isArray(proof.native.checks) && proof.native.checks.length >= 4);
  evidence.native = proof.native;
  evidence.checks.push(...proof.native.checks, 'normal-electron-quit-exits-owned-app');
} catch (error) {
  failure = error;
  evidence.failedStage = phase;
  evidence.errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code : error instanceof assert.AssertionError ? 'QA_ASSERTION_FAILED' : 'NATIVE_TRAY_QA_FAILED';
} finally {
  try { await stopOwned(); }
  catch { failure ??= new Error('OWNED_CHILD_CLEANUP_INCOMPLETE'); evidence.errorCode ??= 'OWNED_CHILD_CLEANUP_INCOMPLETE'; }
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  evidence.cleanup = { ownedPid: child?.pid ?? null, exitCode, exitSignal, forcedCleanup,
    ownedChildClosed: closed, temporaryProfileRetained: true };
  evidence.passed = !failure && !interrupted && closed && exitCode === 0 && exitSignal === null && !forcedCleanup;
  evidence.stage = evidence.passed ? 'complete' : evidence.failedStage ?? 'cleanup';
  const result = JSON.stringify(evidence, null, 2);
  await Promise.all([writeFile(join(evidenceDirectory, 'result.json'), result), writeFile(join(qaDirectory, 'result.json'), result)]);
  console.log(JSON.stringify({ passed: evidence.passed, platform, evidence: join(evidenceDirectory, 'result.json'),
    retainedTemporaryDirectory: qaDirectory, ...(evidence.errorCode ? { errorCode: evidence.errorCode } : {}) }));
  if (!evidence.passed) process.exitCode = 1;
}
