import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInside } from '../scripts/installed-smoke-support.mjs';

// Run the real entry with Electron fully replaced. The only URI is rejected before API/storage/CLI work.
const bootstrap = String.raw`
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const fixture = JSON.parse(process.env.CONNECTOR_TRAY_FIXTURE);
const windows = [], trays = [], states = [], petStates = [], external = [], events = [], requests = [], handlers = new Map();
let protocolCalls = 0;
const app = Object.assign(new EventEmitter(), {
  isPackaged: fixture.packaged === true, getVersion: () => fixture.version ?? '0.1.5', setName() {}, setPath(_key, value) { this.userData = value; },
  getPath(key) { return key === 'appData' ? fixture.owned : this.userData; },
  requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
  setAsDefaultProtocolClient: () => { protocolCalls += 1; return false; }, exit(code) { events.push('exit'); this.exitCode = code; }, quit() {},
});
class BrowserWindow extends EventEmitter {
  constructor(options) { super(); this.options = options; this.visible = false; this.focusCalls = 0; this.inactiveCalls = 0; windows.push(this);
    this.webContents = Object.assign(new EventEmitter(), { mainFrame: {}, send(channel, state) { if (channel === 'connector:pet-state') petStates.push(state); else states.push(state); }, setWindowOpenHandler() {} }); }
  isDestroyed() { return this.closed === true; } isVisible() { return this.visible; }
  show() { this.visible = true; } hide() { this.visible = false; } focus() { this.focusCalls += 1; }
  showInactive() { this.visible = true; this.inactiveCalls += 1; }
  setMenu() {}
  close() { this.closed = true; this.emit('closed'); }
  loadFile() { queueMicrotask(() => { this.webContents.emit('did-finish-load'); this.emit('ready-to-show'); }); }
}
class Tray extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.destroyCalls = 0; trays.push(this); }
  setToolTip(value) { if (this.failUpdate) throw new Error('Synthetic native tray failure'); this.tooltip = value; } setContextMenu(menu) { this.menu = menu; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.destroyCalls += 1; events.push('tray-destroy'); }
}
const electron = { app, BrowserWindow, Tray, Menu: { buildFromTemplate: value => value },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize() { return this; }, setTemplateImage() {} }) },
  ipcMain: { removeHandler(name) { handlers.delete(name); }, handle(name, handler) { handlers.set(name, handler); } },
  nativeTheme: {}, safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test',
    encryptString: value => Buffer.from(value), decryptString: value => value.toString() }, shell: { openExternal: async () => external.push('open-web') },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }) },
};
globalThis.__trayElectron = electron;
const moduleText = Object.keys(electron).map(key => 'export const ' + key + '=globalThis.__trayElectron.' + key + ';').join('\n');
globalThis.__versionApi = { async post(route, body) {
  requests.push({ route, body });
  const leaseExpiresAt = new Date(Date.now() + 45000).toISOString();
  if (route === 'ack') return { attemptId: 'version-attempt', status: 'connected', deviceId: 'version-device', leaseExpiresAt };
  if (route === 'heartbeat') return { leaseExpiresAt, cancelJobIds: [] };
  if (route === 'claim') return null;
  throw new Error('Unexpected fixture route');
} };
class PetSession extends EventEmitter {
  constructor(options) { super(); this.options = options; this.state = { status: 'disconnected', currentJobId: null, providers: [] }; globalThis.__briSession = this; }
  getState() { return this.state; }
  set(value) { Object.assign(this.state, value); this.emit('state', this.state); }
  start() { this.set({ status: 'connected' }); }
  tick() { void globalThis.__versionApi.post('heartbeat', { bridgeVersion: this.options.bridgeVersion, bridgeArchitecture: this.options.bridgeArchitecture }); }
  setProviders(providers) { this.set({ providers }); }
  stop() { this.set({ status: 'disconnected', currentJobId: null }); }
  async whenIdle() {}
}
globalThis.__PetSession = PetSession;
registerHooks({ resolve(specifier, context, next) {
  const text = specifier === 'electron' ? moduleText
    : fixture.pet && /\/core\/runtime\.mjs$/.test(specifier) ? 'export const ConnectorSession = globalThis.__PetSession;'
    : fixture.version && /\/core\/api\.mjs$/.test(specifier) ? 'export const createApiClient = () => globalThis.__versionApi;'
    : fixture.version && /\/core\/adapters\.mjs$/.test(specifier) ? 'export const createProviderAdapter = () => ({detect:async()=>({provider:"codex",status:"ready",models:[],quota:null,observedAt:new Date().toISOString()})});'
    : null;
  return text ? { url: 'data:text/javascript,' + encodeURIComponent(text), shortCircuit: true } : next(specifier, context);
} });
process.argv.push('--connector-dev', '--no-auto-open');
Object.defineProperty(process, 'resourcesPath', { value: join(fixture.root, 'connector'), configurable: true });
if (fixture.qa) process.argv.push('--connector-qa');
if (fixture.qaTray) process.argv.push('--connector-qa-tray');
async function until(predicate) {
  const deadline = Date.now() + 1500;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('SYNTHETIC_WAIT_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
try {
  await import(pathToFileURL(join(fixture.root, 'connector/desktop/main.mjs')).href);
  await until(() => windows.length && states.length);
  const quiet = fixture.qa === true && fixture.packaged !== true;
  const expectedTray = !quiet || fixture.qaTray === true;
  assert.equal(trays.length, expectedTray ? 1 : 0, 'NATIVE_TRAY_COUNT');
  assert.equal(states.at(-1).trayAvailable, expectedTray); assert.equal(states.at(-1).closeToTray, false);
  const window = windows[0], tray = trays[0];
  assert.equal(window.options.webPreferences.offscreen, quiet);
  if (quiet) assert.equal(protocolCalls, 0, 'QUIET_QA_REGISTERED_PROTOCOL');
  if (tray) {
    window.hide(); tray.menu.find(item => item.label === 'AI 브릿지 열기').click();
    assert.equal(window.visible, !quiet); assert.equal(window.focusCalls, quiet ? 0 : 1);
  }
  window.hide(); app.emit('second-instance', {}, ['hapark-connect://invalid']);
  await until(() => states.at(-1).stage === 'error');
  assert.equal(window.visible, !quiet);
  if (tray) assert.equal(tray.tooltip, 'AI 브릿지 · 연결 오류');
  if (fixture.version) {
    assert.equal(states.at(-1).bridgeVersion, fixture.version, 'STATE_MUST_USE_ACTUAL_APP_VERSION');
    assert.equal(states.at(-1).bridgeArchitecture, ['x64', 'arm64'].includes(process.arch) ? process.arch : undefined);
    app.emit('second-instance', {}, ['hapark-connect://connect?attemptId=version-attempt&launchToken=' + 't'.repeat(43)]);
    await until(() => requests.some(value => value.route === 'heartbeat'));
    const heartbeat = requests.find(value => value.route === 'heartbeat').body;
    assert.equal(heartbeat.bridgeVersion, fixture.version, 'HEARTBEAT_MUST_USE_ACTUAL_APP_VERSION');
    assert.equal(heartbeat.bridgeArchitecture, ['x64', 'arm64'].includes(process.arch) ? process.arch : undefined);
  }
  if (fixture.pet) {
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    const toggle = handlers.get('connector:pet');
    assert.equal((await toggle({ sender: {}, senderFrame: {} }, true)).ok, false);
    assert.equal(windows.length, 1, 'PET_DEFAULT_OFF');
    await toggle(event, true);
    await until(() => petStates.length > 0);
    const pet = windows[1];
    assert.match(pet.options.webPreferences.preload, /pet-preload\.cjs$/);
    assert.equal(pet.options.webPreferences.sandbox, true);
    assert.equal(pet.options.webPreferences.contextIsolation, true);
    assert.equal(pet.options.webPreferences.nodeIntegration, false);
    assert.equal(pet.options.focusable, false); assert.equal(pet.options.show, false);
    assert.equal(pet.inactiveCalls, quiet ? 0 : 1);
    assert.equal(pet.focusCalls, 0);
    assert.equal(petStates.at(-1), 'ready');
    const session = globalThis.__briSession;
    session.set({ currentJobId: 'sensitive-job-id' });
    assert.equal(petStates.at(-1), 'working'); assert.equal(states.at(-1).briMode, 'working');
    session.set({ status: 'recovering' });
    assert.equal(petStates.at(-1), 'recovering');
    session.set({ status: 'authorization_required' });
    assert.equal(petStates.at(-1), 'disconnected');
    pet.webContents.emit('did-finish-load');
    assert.equal(petStates.at(-1), 'disconnected', 'RELOAD_MUST_USE_CURRENT_STATE');
    assert.ok(petStates.every(value => typeof value === 'string' && !value.includes('sensitive')));
    await toggle(event, false); assert.equal(pet.closed, true);
  }
  assert.equal(window.inactiveCalls, 0, 'Normal status changes must not restore a window.');
  if (fixture.breakTray) {
    const focused = window.focusCalls;
    window.hide(); tray.failUpdate = true;
    const pause = handlers.get('connector:pause');
    const ipcEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    await pause(ipcEvent);
    assert.equal(window.inactiveCalls, quiet ? 0 : 1, 'TRAY_FAILURE_NOT_RECOVERED');
    assert.equal(window.visible, !quiet);
    assert.equal(window.focusCalls, focused, 'Tray failure must not steal focus.');
    assert.equal(states.at(-1).trayAvailable, false); assert.equal(states.at(-1).closeToTray, false);
    await pause(ipcEvent);
    assert.equal(window.inactiveCalls, quiet ? 0 : 1, 'Tray loss must restore at most once.');
  }
  if (!fixture.packaged) assert.deepEqual(external, []);
  let prevented = false;
  app.emit('before-quit', { preventDefault() { prevented = true; } });
  await until(() => events.includes('exit'));
  assert.equal(prevented, true);
  if (tray) assert.equal(tray.destroyCalls, 1);
  assert.deepEqual(events, tray ? ['tray-destroy', 'exit'] : ['exit']);
  assert.equal(app.exitCode, 0); assert.equal(windows.length, fixture.pet ? 2 : 1);
  console.log(JSON.stringify({ passed: true, actualElectron: false, cliInference: false, protocolRegistration: false }));
} catch (error) {
  const marker = ['NATIVE_TRAY_COUNT', 'TRAY_FAILURE_NOT_RECOVERED'].find(value => error.message.includes(value));
  console.log(JSON.stringify({ passed: false, reason: marker ?? error.code ?? error.name }));
  process.exitCode = 1;
}
`;

async function runMainFixture(options = {}) {
  const owned = await mkdtemp(join(tmpdir(), 'connector-tray-main-'));
  try {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const result = spawnSync(process.execPath, ['--input-type=module', '-'], { input: bootstrap,
      env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
        CONNECTOR_TRAY_FIXTURE: JSON.stringify({ root, owned, ...options }) },
      windowsHide: true, shell: false, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stdout.trim() || 'Isolated main startup did not finish.');
    assert.deepEqual(JSON.parse(result.stdout), { passed: true, actualElectron: false, cliInference: false, protocolRegistration: false });
  } finally { assertInside(owned, tmpdir()); await rm(owned, { recursive: true }); }
}

test('real main connects native menu and URI restoration to one window and disposes on before-quit', async () => {
  await runMainFixture();
});

test('quiet QA opts into the native tray while retaining hidden offscreen windows and no protocol registration', async () => {
  await runMainFixture({ qa: true, qaTray: true });
});

test('quiet QA without its explicit tray flag still creates no native indicator', async () => {
  await runMainFixture({ qa: true });
});

test('packaged main ignores both development QA flags and retains a normal visible window', async () => {
  await runMainFixture({ packaged: true, qa: true, qaTray: true });
});

test('a hidden window losing its working tray returns once without focus', async () => {
  await runMainFixture({ breakTray: true });
});

test('quiet QA tray failure publishes unavailable state without showing its offscreen window', async () => {
  await runMainFixture({ qa: true, qaTray: true, breakTray: true });
});

test('native state and heartbeat use Electron app.getVersion rather than the development package version', async () => {
  await runMainFixture({ qa: true, version: '9.8.7-native.2+fixture' });
});

test('main sends only the current Bri mode to an opt-in pet and rehydrates after reload without focus', async () => {
  await runMainFixture({ qa: true, version: '9.8.7-native.2+fixture', pet: true });
  await runMainFixture({ version: '9.8.7-native.2+fixture', pet: true });
});
