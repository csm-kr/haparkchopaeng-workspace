import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInside } from '../scripts/installed-smoke-support.mjs';

const bootstrap = String.raw`
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const fixture = JSON.parse(process.env.CONNECTOR_TRAY_FIXTURE);
const packagedConfig = { version: 1, development: false, applications: [{
  id: 'hapark', name: 'Tray fixture', scheme: 'hapark-connect',
  origin: 'https://tray-fixture.example', allowedOrigins: ['https://tray-fixture.example'],
}] };
const configPath = join(fixture.root, 'connector/desktop/apps.generated.json');
const readFile = fs.readFile;
fs.readFile = (path, ...options) => path === configPath ? Promise.resolve(JSON.stringify(packagedConfig)) : readFile(path, ...options);
syncBuiltinESMExports();
const windows = [], trays = [], states = [], petStates = [], external = [], events = [], requests = [], handlers = new Map(), listeners = new Map();
const cursor = { x: 0, y: 0 };
let protocolCalls = 0;
const app = Object.assign(new EventEmitter(), {
  isPackaged: fixture.packaged === true, getVersion: () => fixture.version ?? '0.1.5', setName() {}, setPath(_key, value) { this.userData = value; },
  getPath(key) { return key === 'appData' ? fixture.owned : this.userData; },
  requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
  setAsDefaultProtocolClient: () => { protocolCalls += 1; return false; }, exit(code) { events.push('exit'); this.exitCode = code; }, quit() {},
});
class BrowserWindow extends EventEmitter {
  constructor(options) { super(); this.options = options; this.visible = false; this.focusCalls = 0; this.inactiveCalls = 0; this.position = [options.x ?? 0, options.y ?? 0]; windows.push(this);
    this.webContents = Object.assign(new EventEmitter(), { mainFrame: {}, send(channel, state) { if (channel === 'connector:pet-state') petStates.push(state); else states.push(state); }, setWindowOpenHandler() {} }); }
  isDestroyed() { return this.closed === true; } isVisible() { return this.visible; }
  show() { this.visible = true; } hide() { this.visible = false; } focus() { this.focusCalls += 1; }
  showInactive() { this.visible = true; this.inactiveCalls += 1; }
  setMenu() {}
  getPosition() { return [...this.position]; } setPosition(x, y) { this.position = [x, y]; }
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
  ipcMain: { removeHandler(name) { handlers.delete(name); }, handle(name, handler) { handlers.set(name, handler); },
    removeAllListeners(name) { listeners.delete(name); }, on(name, listener) { listeners.set(name, listener); } },
  nativeTheme: {}, safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test',
    encryptString: value => Buffer.from(value), decryptString: value => value.toString() }, shell: { openExternal: async url => external.push(url) },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }), getCursorScreenPoint: () => ({ ...cursor }) },
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
  async whenIdle() { if (fixture.cleanup && !globalThis.__waitedCleanup) { globalThis.__waitedCleanup = true; await new Promise(resolve => { globalThis.__releaseCleanup = resolve; }); } }
}
globalThis.__PetSession = PetSession;
registerHooks({ resolve(specifier, context, next) {
  const text = specifier === 'electron' ? moduleText
    : fixture.pet && /\/core\/runtime\.mjs$/.test(specifier) ? 'export const ConnectorSession = globalThis.__PetSession;'
    : fixture.version && /\/core\/api\.mjs$/.test(specifier) ? 'export const createApiClient = () => globalThis.__versionApi;'
    : /\/core\/adapters\.mjs$/.test(specifier) ? 'export const createProviderAdapter = () => ({detect:async()=>({provider:"codex",status:"ready",models:[],quota:null,observedAt:new Date().toISOString()})});'
    : null;
  return text ? { url: 'data:text/javascript,' + encodeURIComponent(text), shortCircuit: true } : next(specifier, context);
} });
process.argv.push('--connector-dev', '--no-auto-open');
Object.defineProperty(process, 'resourcesPath', { value: join(fixture.root, 'connector'), configurable: true });
if (fixture.qa) process.argv.push('--connector-qa');
if (fixture.qaTray) process.argv.push('--connector-qa-tray');
async function until(predicate, label) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() > deadline) throw Object.assign(new Error('Main fixture condition not reached'), {
      code: 'MAIN_FIXTURE_WAIT_TIMEOUT', condition: label,
      observed: { windows: windows.length, states: states.length, stage: states.at(-1)?.stage,
        providers: states.at(-1)?.providers.length, browserActions: external.length, requests: requests.length, events: events.length },
    });
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
try {
  await import(pathToFileURL(join(fixture.root, 'connector/desktop/main.mjs')).href);
  await until(() => windows.length && states.length, 'initial window state');
  if (fixture.packaged) {
    await until(() => external.length === 1, 'packaged first-launch browser handoff');
    assert.deepEqual(external, ['https://tray-fixture.example/profile?localAgentResume=1']);
    assert.equal(windows[0].visible, true);
  }
  const quiet = fixture.qa === true && fixture.packaged !== true;
  const expectedTray = !quiet || fixture.qaTray === true;
  assert.equal(trays.length, expectedTray ? 1 : 0, 'NATIVE_TRAY_COUNT');
  assert.equal(states.at(-1).trayAvailable, expectedTray); assert.equal(states.at(-1).closeToTray, false);
  if (!fixture.packaged) {
    await until(() => states.at(-1).providers.length > 0, 'local provider metadata');
    assert.equal(requests.length, 0, 'LOCAL_DISCOVERY_MUST_NOT_REQUIRE_A_WEB_GRANT');
  }
  const window = windows[0], tray = trays[0];
  const localEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.equal((await handlers.get('connector:terminal')(localEvent, 'codex; private-command')).ok, false);
  assert.equal((await handlers.get('connector:terminal')({ sender: {}, senderFrame: {} }, 'codex')).ok, false);
  assert.equal(window.options.webPreferences.offscreen, quiet);
  if (quiet) assert.equal(protocolCalls, 0, 'QUIET_QA_REGISTERED_PROTOCOL');
  if (tray) {
    window.hide(); tray.menu.find(item => item.label === 'AI 브릿지 열기').click();
    assert.equal(window.visible, !quiet); assert.equal(window.focusCalls, quiet ? 0 : 1);
  }
  window.hide(); app.emit('second-instance', {}, ['hapark-connect://invalid']);
  await until(() => states.at(-1).stage === 'error', 'invalid URI error');
  assert.equal(requests.length, 0, 'INVALID_URI_MUST_NOT_REACH_API');
  assert.equal(states.at(-1).connectionStatus, 'disconnected'); assert.equal(states.at(-1).webReady, false);
  assert.deepEqual(states.at(-1).activity, { kind: 'idle' });
  assert.equal(window.visible, !quiet);
  if (tray) assert.equal(tray.tooltip, 'AI 브릿지 · 연결 오류');
  if (fixture.navigation) {
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    await handlers.get('connector:open-web')(event, 'https://attacker.test');
    assert.equal(external.at(-1), 'http://localhost:3000/profile?localAgentResume=1');
  }
  if (fixture.version) {
    assert.equal(states.at(-1).bridgeVersion, fixture.version, 'STATE_MUST_USE_ACTUAL_APP_VERSION');
    assert.equal(states.at(-1).bridgeArchitecture, ['x64', 'arm64'].includes(process.arch) ? process.arch : undefined);
    app.emit('second-instance', {}, ['hapark-connect://connect?attemptId=version-attempt&launchToken=' + 't'.repeat(43)]);
    await until(() => requests.some(value => value.route === 'heartbeat'), 'version heartbeat');
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
    await until(() => petStates.length > 0, 'pet state');
    const pet = windows[1];
    assert.match(pet.options.webPreferences.preload, /pet-preload\.cjs$/);
    assert.equal(pet.options.webPreferences.sandbox, true);
    assert.equal(pet.options.webPreferences.contextIsolation, true);
    assert.equal(pet.options.webPreferences.nodeIntegration, false);
    assert.equal(pet.options.focusable, false); assert.equal(pet.options.show, false);
    // The pet never becomes active, so without this a macOS click would only try to activate it.
    assert.equal(pet.options.acceptFirstMouse, true, 'PET_CLICK_REACHES_PAGE_WITHOUT_FOCUS');
    assert.deepEqual([pet.options.width, pet.options.height], [104, 144], 'PET_WINDOW_FITS_FULL_BODY');
    assert.equal(pet.inactiveCalls, quiet ? 0 : 1);
    assert.equal(pet.focusCalls, 0);
    assert.equal(petStates.at(-1), 'ready');
    const fromPet = { sender: pet.webContents, senderFrame: pet.webContents.mainFrame }, stranger = { sender: {}, senderFrame: {} };
    const signal = (name, from = fromPet) => listeners.get('connector:' + name)?.(from, { x: -9999, y: -9999 });
    const settle = () => new Promise(resolve => setTimeout(resolve, 60));
    window.hide(); const focusBefore = window.focusCalls;
    signal('pet-open-app', stranger); assert.equal(window.visible, false, 'PET_SIGNALS_ONLY_FROM_THE_PET');
    signal('pet-open-app');
    if (!quiet) { assert.equal(window.visible, true, 'PET_RIGHT_CLICK_OPENS_APP'); assert.equal(window.focusCalls, focusBefore + 1); }
    assert.equal(pet.focusCalls, 0);
    pet.position = [1000, 600]; Object.assign(cursor, { x: 1040, y: 650 });
    signal('pet-drag-start', stranger); cursor.x = 900; await settle();
    assert.deepEqual(pet.position, [1000, 600], 'PET_DRAG_ONLY_FROM_THE_PET');
    Object.assign(cursor, { x: 1040, y: 650 }); signal('pet-drag-start');
    Object.assign(cursor, { x: 900, y: 500 });
    await until(() => pet.position[0] === 860 && pet.position[1] === 450, 'pet follows the real cursor, not the page');
    signal('pet-drag-end'); cursor.x = 100; await settle();
    assert.deepEqual(pet.position, [860, 450], 'PET_DRAG_STOPS_ON_RELEASE');
    if (fixture.navigation) {
      await handlers.get('connector:open-web')(event, 'https://attacker.test');
      assert.equal(external.at(-1), 'http://localhost:3000/ai-chat');
      const session = globalThis.__briSession;
      session.set({ activity: { kind: 'running', provider: 'codex', requestedModel: 'model', path: 'private-path', pid: 123, prompt: 'private-prompt' } });
      assert.deepEqual(states.at(-1).activity, { kind: 'running', provider: 'codex', requestedModel: 'model' });
      session.state.activity = { kind: 'finalizing', provider: 'codex' };
      assert.deepEqual((await handlers.get('connector:state')(event)).activity, { kind: 'finalizing' });
      session.set({ status: 'recovering', activity: { kind: 'running', provider: 'codex', requestedModel: 'stale' } });
      assert.deepEqual(states.at(-1).activity, { kind: 'idle' });
      assert.equal(states.at(-1).webReady, false);
      await handlers.get('connector:open-web')(event);
      assert.equal(external.at(-1), 'http://localhost:3000/profile?localAgentResume=1');
      session.set({ status: 'connected' });
    }
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
  if (fixture.cleanup) {
    const ackCount = requests.filter(value => value.route === 'ack').length;
    app.emit('second-instance', {}, ['hapark-connect://connect?attemptId=version-attempt&launchToken=' + 't'.repeat(43)]);
    await until(() => states.at(-1).stage === 'opening' && globalThis.__releaseCleanup, 'retired runtime cleanup');
    assert.equal(requests.filter(value => value.route === 'ack').length, ackCount, 'NEW_SESSION_MUST_WAIT_FOR_OWNED_PROCESS_CLEANUP');
    assert.deepEqual(states.at(-1).activity, { kind: 'idle' });
    globalThis.__releaseCleanup();
    await until(() => requests.filter(value => value.route === 'ack').length === ackCount + 1 && states.at(-1).stage === 'connected', 'new session after cleanup');
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
  if (!fixture.packaged && !fixture.navigation) assert.deepEqual(external, []);
  let prevented = false;
  app.emit('before-quit', { preventDefault() { prevented = true; } });
  await until(() => events.includes('exit'), 'graceful exit');
  assert.equal(prevented, true);
  if (tray) assert.equal(tray.destroyCalls, 1);
  assert.deepEqual(events, tray ? ['tray-destroy', 'exit'] : ['exit']);
  assert.equal(app.exitCode, 0); assert.equal(windows.length, fixture.pet ? 2 : 1);
  console.log(JSON.stringify({ passed: true, actualElectron: false, cliInference: false, protocolRegistration: false }));
} catch (error) {
  const marker = ['NATIVE_TRAY_COUNT', 'TRAY_FAILURE_NOT_RECOVERED'].find(value => error.message.includes(value));
  console.log(JSON.stringify({ passed: false, reason: marker ?? error.code ?? error.name, ...(error.code === 'MAIN_FIXTURE_WAIT_TIMEOUT' ? { condition: error.condition, observed: error.observed } : {}) }));
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

test('current runtime state controls native execution projection and fixed-origin web destination', async () => {
  await runMainFixture({ qa: true, version: '9.8.7-native.2+fixture', pet: true, navigation: true });
});

test('a fresh connection waits for the retired runtime cleanup before accepting another web grant', async () => {
  await runMainFixture({ qa: true, version: '9.8.7-native.2+fixture', pet: true, cleanup: true });
});
