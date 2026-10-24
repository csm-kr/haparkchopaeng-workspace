import { app, BrowserWindow, ipcMain, nativeTheme, safeStorage, shell, screen } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, basename } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { createConnectorTray, shouldHideWindowToTray, shutdownWithTray } from './tray.mjs';
import { retireLegacyMacBundles } from './legacy-mac-bundle.mjs';
import { selectBriMode } from './renderer/bri-state.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const pendingUrls = [];
let readyForLaunches = false, launchRequested = false;
// Register synchronously: macOS may deliver a cold-start URL during asynchronous imports.
app.on('open-url', (event, url) => { event.preventDefault(); launchRequested = true; pendingUrls.push(url); if (readyForLaunches) void consumeLaunches(); });
const configuredDataDirectory = !app.isPackaged ? process.argv.find(value => value.startsWith('--connector-data-dir='))?.slice('--connector-data-dir='.length) : null;
const { productName, stableProfileName } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
const bridgeMetadata = { bridgeVersion: app.getVersion(), ...(['arm64', 'x64'].includes(process.arch) ? { bridgeArchitecture: process.arch } : {}) };
if (typeof stableProfileName !== 'string' || !stableProfileName || basename(stableProfileName) !== stableProfileName
  || /[\\/\u0000-\u001f]/.test(stableProfileName) || ['.', '..'].includes(stableProfileName)) throw new Error('기존 연결 정보의 저장 경로를 확인해 주세요.');
// Preserve the prior safeStorage service identity and vault location across display-name changes.
app.setName(stableProfileName);
const userDataDirectory = configuredDataDirectory || join(app.getPath('appData'), stableProfileName);
mkdirSync(userDataDirectory, { recursive: true, mode: 0o700 });
app.setPath('userData', userDataDirectory);
const coreRoot = app.isPackaged ? join(process.resourcesPath, 'core') : join(directory, '..', 'core');
const [{ normalizeOrigin, parseLaunchUrl, createDeviceIdentity }, { createApiClient }, { createCredentialStore }, { createProviderAdapter }, { ConnectorSession }, { desktopAckInput, desktopPairInput }, { shouldExitWithoutWeb, shouldOpenFirstWeb, stopBeforeExit }] = await Promise.all(['security', 'api', 'storage', 'adapters', 'runtime', 'protocol', 'lifetime'].map(name => import(pathToFileURL(join(coreRoot, `${name}.mjs`)).href)));
const development = !app.isPackaged && process.argv.includes('--connector-dev');
const suppressAutoOpen = !app.isPackaged && process.argv.includes('--no-auto-open');
const quietQa = !app.isPackaged && process.argv.includes('--connector-qa');
const qaTray = !app.isPackaged && process.argv.includes('--connector-qa-tray');
let applications = [], mainWindow, petWindow, selectedApp, store, attempt = null, identity = null, runtime = null, adapters = {}, revision = 0, requestController = null, monitoringController = null, monitorTimer = null, refreshPromise = null;
let preferences = { autoStart: false, pet: false, firstBrowserOpened: false };
let quitting = false, qaWindowHidden = false, tray;
let state = { stage: 'idle', title: '웹에서 AI 연결을 눌러 주세요', description: '한 번 연결하면 다음부터 웹 버튼으로 이 앱을 바로 열 수 있어요.', message: '', providers: [], appName: productName, siteName: '하박조팽', teamName: '', memberName: '', deviceName: '', attemptId: null, expiresAt: null, autoStart: false, pet: false, platform: process.platform, trayAvailable: false, closeToTray: false, ...bridgeMetadata };
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => { const urls = argv.filter(value => /^[a-z][a-z0-9+.-]*:\/\//i.test(value)); launchRequested ||= urls.length > 0; pendingUrls.push(...urls); showWindow(); if (store) void consumeLaunches(); });
  app.on('activate', () => showWindow());
  app.on('window-all-closed', () => { if (shouldExitWithoutWeb({ authorized: runtime && ['connected','recovering'].includes(runtime.getState().status), windowVisible: false, autoStart: preferences.autoStart, pet: preferences.pet })) void shutdown(); });
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void shutdown(); } });
  // Electron waits for the ESM entry module before emitting ready: do not await ready at top level.
  void app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  try {
    const { Tray, Menu, nativeImage } = await import('electron');
    tray = createConnectorTray({ Tray, Menu, nativeImage, platform: process.platform, productName,
      iconPath: join(directory, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'),
      disabled: quietQa && !qaTray, onOpen: showWindow, onQuit: () => { void shutdown(); } });
    let config;
    if (development) config = { applications: [{ id: 'hapark', name: '하박조팽', scheme: 'hapark-connect', origin: 'http://localhost:3000', allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'] }] };
    else { try { config = JSON.parse(await readFile(join(directory, 'apps.generated.json'), 'utf8')); } catch { throw new Error('등록된 웹앱 설정이 없어요. 배포 주소를 설정한 앱을 사용해 주세요.'); } }
    if (app.isPackaged && config.development) throw new Error('개발용 서버 설정은 배포할 수 없어요.');
    applications = config.applications.map(value => ({ ...value, origin: normalizeOrigin(value.origin, { development }), allowedOrigins: value.allowedOrigins.map(origin => normalizeOrigin(origin, { development })) }));
    if (!applications.length || new Set(applications.map(value => value.scheme)).size !== applications.length) throw new Error('연결 앱 설정을 확인해 주세요.');
    selectedApp = applications[0]; state.siteName = selectedApp.name;
    const preferencesFile = join(app.getPath('userData'), 'preferences.json');
    try { const saved = JSON.parse(await readFile(preferencesFile, 'utf8')); preferences = { autoStart: saved.autoStart === true, pet: saved.pet === true, firstBrowserOpened: saved.firstBrowserOpened === true }; } catch {}
    state.autoStart = preferences.autoStart; state.pet = preferences.pet;
    store = createCredentialStore(join(app.getPath('userData'), 'devices.enc.json'), {
      available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
      encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value),
    });
    // Unregister pre-rename copies first so the URL scheme resolves to this bundle.
    if (!quietQa) await retireLegacyMacBundles({ platform: process.platform, packaged: app.isPackaged, execPath: process.execPath, home: homedir(), lstat,
      readBundleId: async path => (await promisify(execFile)('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(path, 'Contents', 'Info.plist')], { timeout: 5000 })).stdout.trim(),
      unregister: path => promisify(execFile)('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-u', path], { timeout: 10_000 }),
      trash: path => shell.trashItem(path) });
    for (const application of applications) {
      if (!quietQa) app.setAsDefaultProtocolClient(application.scheme, ...(app.isPackaged ? [] : [process.execPath, [directory, '--connector-dev', '--no-auto-open']]));
    }
    installIpc(); showWindow(); readyForLaunches = true;
    const commandLineUrls = process.argv.filter(value => applications.some(application => value.startsWith(`${application.scheme}://`)));
    launchRequested ||= commandLineUrls.length > 0;
    pendingUrls.push(...commandLineUrls);
    await consumeLaunches();
    if (shouldOpenFirstWeb({ packaged: app.isPackaged, launchRequested, hasAttempt: !!attempt, firstBrowserOpened: preferences.firstBrowserOpened, suppressAutoOpen })) {
      preferences.firstBrowserOpened = true; await savePreferences();
      state = { ...state, stage: 'idle', title: '브라우저에서 연결을 이어 주세요', description: '로그인한 웹에서 연결 요청을 확인하고 이 앱으로 돌아와요.' }; publish(); await openWeb();
    }
    if (preferences.pet) showPet();
  } catch (error) {
    state = { ...state, stage: 'error', title: 'AI 브릿지를 준비하지 못했어요', description: error.message }; installIpc(); showWindow(); publish();
  }
  }).catch(() => app.exit(1));
}

function showWindow() {
  if (quitting) return;
  qaWindowHidden = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    const height = Math.min(724, screen.getPrimaryDisplay().workArea.height - 48);
    mainWindow = new BrowserWindow({ width: 452, height, minWidth: 390, minHeight: Math.min(height, 590), show: false, backgroundColor: '#0E0F0C', icon: join(directory,'assets','icon.png'), title: productName, autoHideMenuBar: true, webPreferences: { preload: join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: quietQa, backgroundThrottling: !quietQa, devTools: !app.isPackaged } });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.loadFile(join(directory, 'renderer', 'index.html'));
    mainWindow.once('ready-to-show', () => { if (!quietQa) mainWindow.show(); publish(); });
    mainWindow.on('close', event => {
      const authorized = !!runtime && ['connected', 'recovering'].includes(runtime.getState().status);
      if (!quitting && authorized) {
        event.preventDefault();
        if (shouldHideWindowToTray({ platform: process.platform, authorized, trayAvailable: !!tray?.available, quitting })) {
          qaWindowHidden = true; mainWindow.hide();
        } else void shutdown(); // A missing desktop indicator must not leave an unreachable process.
      }
    });
  } else if (!quietQa) { mainWindow.show(); mainWindow.focus(); }
}

function publish() {
  const runtimeState = runtime?.getState();
  const runtimeStatus = runtimeState?.status;
  state.briMode = selectBriMode({ stage: state.stage, runtime: runtimeState });
  const previouslyAvailable = state.trayAvailable;
  tray?.updateStage(runtimeStatus === 'recovering' ? 'recovering' : state.stage);
  state.trayAvailable = !!tray?.available;
  if (previouslyAvailable && !state.trayAvailable && !quietQa && !quitting
    && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    qaWindowHidden = false; mainWindow.showInactive();
  }
  state.closeToTray = shouldHideWindowToTray({ platform: process.platform,
    authorized: !!runtime && ['connected', 'recovering'].includes(runtimeStatus), trayAvailable: state.trayAvailable, quitting });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('connector:state', { ...state });
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('connector:pet-state', state.briMode);
}
async function shutdown() {
  if (quitting) return;
  quitting = true;
  tray?.updateStage('quitting');
  await shutdownWithTray({ tray, cleanup: () => stopBeforeExit({ runtime,
    stopMonitoring: () => { monitoringController?.abort(); requestController?.abort(); if (monitorTimer) clearInterval(monitorTimer); return refreshPromise; },
    exit() {} }), exit: () => app.exit(0) });
}
async function savePreferences() { await mkdir(app.getPath('userData'), { recursive: true }); await writeFile(join(app.getPath('userData'), 'preferences.json'), JSON.stringify(preferences)); }
async function openWeb() {
  if (!selectedApp) return { ok: false };
  await shell.openExternal(`${selectedApp.origin}/profile?localAgentResume=1`); return { ok: true };
}
function api(application = selectedApp) { return createApiClient({ origin: application.origin, allowedOrigins: application.allowedOrigins, development }); }

async function consumeLaunches() {
  while (pendingUrls.length) { const url = pendingUrls.shift(); await beginLaunch(url); }
}
async function beginLaunch(url) {
  if (quitting) return;
  const currentRevision = ++revision; requestController?.abort(); requestController = new AbortController();
  runtime?.stop(); monitoringController?.abort(); if (monitorTimer) clearInterval(monitorTimer); runtime = null;
  state = { ...state, stage: 'opening', title: '웹의 연결 요청을 확인하고 있어요', description: '연결할 사이트와 계정을 확인해요.', message: '', providers: [], attemptId: null }; publish(); showWindow();
  try {
    const launch = parseLaunchUrl(url, applications), application = launch.application;
    const localIdentity = await store.load(application.id) ?? createDeviceIdentity();
    if (revision !== currentRevision) return;
    await store.save(application.id, localIdentity);
    if (revision !== currentRevision) return;
    const response = await api(application).post('ack', desktopAckInput(launch, localIdentity), undefined, requestController.signal);
    if (revision !== currentRevision) return;
    if (response.attemptId !== launch.attemptId || !['awaiting_code', 'connected'].includes(response.status)) throw new Error('연결 요청을 다시 확인해 주세요.');
    selectedApp = application; identity = localIdentity;
    attempt = { ...launch, response }; state = { ...state, siteName: response.siteName, teamName: response.teamName, memberName: response.memberName, deviceName: identity.deviceName, attemptId: response.attemptId, expiresAt: response.expiresAt };
    if (response.status === 'connected') await connected(response, currentRevision);
    else { state = { ...state, stage: 'pairing', title: '웹에 표시된 번호를 입력해 주세요', description: '이 브라우저와 이 PC를 연결하는 일회용 번호예요.', message: '' }; publish(); }
  } catch (error) { if (revision === currentRevision) { state = { ...state, stage: 'error', title: '연결을 이어 가지 못했어요', description: error.message, message: '' }; publish(); } }
}

async function pair(code) {
  if (state.stage !== 'pairing' || !attempt || !/^\d{6}$/.test(code)) return { ok: false, message: '웹의 6자리 번호를 입력해 주세요.' };
  const currentRevision = revision; state.message = ''; publish();
  try {
    const response = await api().post('pair', desktopPairInput(attempt, identity, code), undefined, requestController.signal);
    if (revision !== currentRevision) return { ok: false, message: '새 연결 요청에서 다시 입력해 주세요.' };
    await connected(response, currentRevision); return { ok: true };
  } catch (error) { if (revision === currentRevision) { if (error.status === 410) state = { ...state, stage: 'authorization_required', title: '새 번호가 필요해요', description: error.message, message: '' }; else state.message = error.message; publish(); } return { ok: false, message: error.message }; }
}
async function connected(response, currentRevision) {
  if (currentRevision !== revision || !response.deviceId || !response.leaseExpiresAt) throw new Error('웹 연결 권한을 확인해 주세요.');
  identity = { ...identity, deviceId: response.deviceId }; await store.save(selectedApp.id, identity);
  if (currentRevision !== revision) return;
  state = { ...state, stage: 'connected', title: '이 PC가 연결됐어요', description: '웹에서 사용할 AI와 모델을 직접 선택해 주세요.', message: '', expiresAt: null }; publish();
  const workspaceRoot = join(app.getPath('userData'), 'workspaces');
  adapters = Object.fromEntries(['codex', 'claude'].map(provider => [provider, createProviderAdapter(provider, { workspaceRoot })]));
  runtime = new ConnectorSession({ api: api(), identity, adapters, ...bridgeMetadata });
  runtime.on('state', update => {
    if (currentRevision !== revision) return;
    state.providers = update.providers;
    if (update.status === 'authorization_required') { state.stage = 'authorization_required'; state.title = '웹에서 다시 연결해 주세요'; state.description = '로그아웃되었거나 웹 연결 권한이 만료됐어요.'; monitoringController?.abort(); }
    if (update.status === 'recovering') state.message = update.message;
    else if (update.status === 'connected') state.message = update.currentJobId ? '웹의 질문에 답하고 있어요.' : '';
    publish();
    if (update.status === 'authorization_required' && shouldExitWithoutWeb({ authorized: false, windowVisible: quietQa ? !qaWindowHidden : !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(), autoStart: preferences.autoStart, pet: preferences.pet })) void shutdown();
  });
  runtime.start(response.leaseExpiresAt); void runtime.tick();
  monitoringController = new AbortController();
  void refreshProviders(); monitorTimer = setInterval(() => { void refreshProviders(); }, 30000); monitorTimer.unref();
}
function refreshProviders() {
  if (refreshPromise) return refreshPromise;
  if (!runtime || !monitoringController || monitoringController.signal.aborted) return Promise.resolve({ ok: false });
  const currentRevision = revision, currentRuntime = runtime, signal = monitoringController.signal;
  refreshPromise = Promise.all(Object.values(adapters).map(adapter => adapter.detect(signal).catch(() => adapter.getSnapshot()))).then(providers => { if (currentRevision === revision && currentRuntime === runtime && !signal.aborted) currentRuntime.setProviders(providers); return { ok: true }; }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function installIpc() {
  for (const channel of ['state', 'pair', 'open-web', 'refresh', 'pause', 'quit', 'auto-start', 'pet', 'help']) ipcMain.removeHandler(`connector:${channel}`);
  const handle = (name, handler) => ipcMain.handle(`connector:${name}`, async (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return { ok: false };
    try { return await handler(...args); } catch { return { ok: false, message: '작업을 완료하지 못했어요. 다시 시도해 주세요.' }; }
  });
  handle('state', () => ({ ...state })); handle('pair', pair); handle('open-web', openWeb); handle('refresh', refreshProviders);
  handle('pause', () => { ++revision; requestController?.abort(); runtime?.stop(); monitoringController?.abort(); if (monitorTimer) clearInterval(monitorTimer); runtime = null; attempt = null; state = { ...state, stage: 'idle', title: '연결을 중지했어요', description: '다음에는 웹의 AI 연결 버튼으로 다시 시작할 수 있어요.', providers: [], message: '', attemptId: null }; publish(); return { ok: true }; });
  handle('quit', () => { void shutdown(); return { ok: true }; });
  handle('auto-start', async enabled => { if (process.platform === 'linux') return { ok: false, message: 'Ubuntu에서는 데스크톱의 시작 프로그램 설정을 사용해 주세요.' }; app.setLoginItemSettings({ openAtLogin: enabled === true }); preferences.autoStart = enabled === true; state.autoStart = preferences.autoStart; await savePreferences(); publish(); return { ok: true }; });
  handle('pet', async enabled => { preferences.pet = enabled === true; state.pet = preferences.pet; if (preferences.pet) showPet(); else { petWindow?.close(); petWindow = null; } await savePreferences(); publish(); return { ok: true }; });
  handle('help', async provider => { if (!['codex', 'claude'].includes(provider)) return { ok: false }; await shell.openExternal(provider === 'codex' ? 'https://learn.chatgpt.com/docs/codex' : 'https://code.claude.com/docs/en/setup'); return { ok: true }; });
}

function showPet() {
  if (petWindow && !petWindow.isDestroyed()) return;
  const bounds = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({ width: 104, height: 112, x: bounds.x + bounds.width - 130, y: bounds.y + bounds.height - 140, show: false, focusable: false, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: process.platform !== 'linux', webPreferences: { preload: join(directory, 'pet-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  petWindow = window;
  window.setMenu(null); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('did-finish-load', publish);
  window.once('ready-to-show', () => { if (!quietQa && !window.isDestroyed()) window.showInactive(); });
  window.on('closed', () => { if (petWindow === window) petWindow = null; });
  window.loadFile(join(directory, 'renderer', 'pet.html'));
}
