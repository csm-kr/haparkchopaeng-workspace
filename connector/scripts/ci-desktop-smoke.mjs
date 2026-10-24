/**
 * Native CI smoke: real Electron + real OS safeStorage, a loopback-only API,
 * and an owned temporary profile. Run after `npm ci --prefix connector/desktop`.
 * Linux needs an unlocked Secret Service (DBus + gnome-keyring) and a display
 * such as Xvfb. There is deliberately no mock-keychain/basic_text fallback.
 * No jobs are queued, no inference is requested, no browser is opened, and
 * --connector-qa suppresses protocol registration and visible app windows.
 */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, open, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

function exactKeys(body, keys) {
  return body && !Array.isArray(body) && typeof body === 'object'
    && Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
}
function validHeartbeatInput(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.providers)
    || !Object.keys(body).every(key => ['providers', 'bridgeVersion', 'bridgeArchitecture'].includes(key))) return false;
  if (Object.hasOwn(body, 'bridgeVersion') && (typeof body.bridgeVersion !== 'string' || body.bridgeVersion.length > 64
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![\s\S])/.test(body.bridgeVersion))) return false;
  if (Object.hasOwn(body, 'bridgeArchitecture') && !['arm64', 'x64'].includes(body.bridgeArchitecture)) return false;
  return true;
}

// Keep runtime preparation testable without spawning Electron or touching a
// credential store. The production caller provides the official installer.
async function prepareElectronRuntime({ packageDirectory, readPath, verifyExecutable, install }) {
  const resolve = async () => {
    const relativePath = (await readPath(join(packageDirectory, 'path.txt'))).trim();
    const executable = join(packageDirectory, 'dist', relativePath);
    await verifyExecutable(executable);
    return executable;
  };
  try { return await resolve(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Electron 44 has no package postinstall. Use its official installer rather
  // than assume npm ci already downloaded path.txt and the native executable.
  await install(join(packageDirectory, 'install.js'));
  return resolve();
}

function nativeProcessDiagnostic(record, stderr) {
  const text = typeof stderr === 'string' ? stderr : '';
  const categories = [
    ['shared-library', /error while loading shared libraries|cannot open shared object file|library not loaded:|dyld[^\n]*image not found/i],
    ['sandbox', /no usable sandbox|suid sandbox helper|failed to move to new namespace|running as root without --no-sandbox|zygote_host_impl_linux|apparmor[^\n]*(?:denied|userns)/i],
    ['display', /missing x server|cannot open display|could not connect to display|unable to open x display|failed to connect to (?:the )?(?:x11|x server|wayland)|platform failed to initialize|ozone_platform_x11/i],
  ];
  const signals = ['SIGABRT', 'SIGTRAP', 'SIGSEGV', 'SIGILL', 'SIGBUS', 'SIGFPE', 'SIGKILL', 'SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGPIPE'];
  return {
    process: /^(?:electron-runtime-install|electron-[1-9][0-9]*)$/.test(record.name) ? record.name : 'unknown',
    exitCode: Number.isSafeInteger(record.exitCode) ? record.exitCode : null,
    exitSignal: signals.includes(record.exitSignal) ? record.exitSignal : null,
    stderrCategory: categories.find(([,pattern]) => pattern.test(text))?.[0] ?? 'unknown',
  };
}

async function runtimePreparationTests() {
  const { test } = await import('node:test');
  await test('the native fixture accepts real legacy and versioned runtime heartbeats without queuing work', async () => {
    const { ConnectorSession } = await import('../core/runtime.mjs');
    for (const metadata of [{}, { bridgeVersion: '0.1.5', bridgeArchitecture: 'x64' }, { bridgeVersion: '0.1.5-preview.1+build.2', bridgeArchitecture: 'arm64' }]) {
      let heartbeatCount = 0, claimCount = 0;
      const api = { post: async (route, body) => {
        if (route === 'heartbeat') {
          assert.equal(validHeartbeatInput(body), true, 'The fixture must accept the actual optional metadata contract.');
          heartbeatCount += 1; return { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [] };
        }
        assert.equal(route, 'claim'); assert.deepEqual(body, {}); claimCount += 1; return null;
      } };
      const session = new ConnectorSession({ api, identity: {}, adapters: {}, now: () => 1000, setIntervalFn: () => 1, clearIntervalFn() {}, ...metadata });
      session.start(new Date(46000).toISOString());
      try { await session.tick(); assert.equal(heartbeatCount, 1); assert.equal(claimCount, 1); }
      finally { session.stop(); }
    }
  });
  await test('native heartbeat fixture rejects unknown fields and malformed explicit bridge metadata', () => {
    for (const body of [null, [], {}, { providers: {} }, { providers: [], privateField: 'never-forward' },
      { providers: [], bridgeVersion: null }, { providers: [], bridgeVersion: 'latest' }, { providers: [], bridgeVersion: '01.1.5' },
      { providers: [], bridgeVersion: '0.1.5-01' }, { providers: [], bridgeVersion: '0.1.5\n' }, { providers: [], bridgeVersion: '0.1.5-' + 'a'.repeat(64) },
      { providers: [], bridgeArchitecture: null }, { providers: [], bridgeArchitecture: 'ia32' }]) assert.equal(validHeartbeatInput(body), false);
  });
  const missing = () => Object.assign(new Error('Missing native runtime'), { code: 'ENOENT' });
  const packageDirectory = join(tmpdir(), 'runtime-preparation-unit');
  await test('ready native runtime skips installer', async () => {
    let installs = 0;
    const value = await prepareElectronRuntime({ packageDirectory, readPath: async () => 'electron', verifyExecutable: async () => {}, install: async () => { installs += 1; } });
    assert.equal(value, join(packageDirectory, 'dist', 'electron')); assert.equal(installs, 0);
  });
  await test('fresh npm package prepares native runtime before resolving its path', async () => {
    let installed = false, installs = 0;
    const value = await prepareElectronRuntime({ packageDirectory,
      readPath: async () => { if (!installed) throw missing(); return 'electron'; },
      verifyExecutable: async () => { if (!installed) throw missing(); },
      install: async () => { installs += 1; installed = true; },
    });
    assert.equal(value, join(packageDirectory, 'dist', 'electron')); assert.equal(installs, 1);
  });
  await test('missing executable is repaired even if path metadata exists', async () => {
    let installed = false, installs = 0;
    await prepareElectronRuntime({ packageDirectory, readPath: async () => 'electron',
      verifyExecutable: async () => { if (!installed) throw missing(); },
      install: async () => { installs += 1; installed = true; },
    });
    assert.equal(installs, 1);
  });
  await test('installer failure stops instead of returning a nonexistent runtime', async () => {
    const failed = Object.assign(new Error('Native installer failed'), { code: 'INSTALL_FAILED' }); let installs = 0;
    await assert.rejects(prepareElectronRuntime({ packageDirectory, readPath: async () => { throw missing(); }, verifyExecutable: async () => {},
      install: async () => { installs += 1; throw failed; },
    }), error => error === failed);
    assert.equal(installs, 1);
  });
  await test('fatal sandbox exit diagnostics retain the signal and never copy sensitive stderr', () => {
    const secret = 'hapark-connect://connect?attemptId=private&launchToken=' + 'a'.repeat(43);
    const diagnostic = nativeProcessDiagnostic({ name: 'electron-1', exitCode: null, exitSignal: 'SIGTRAP' },
      'The SUID sandbox helper binary was found, but is not configured correctly. ' + secret);
    assert.deepEqual(diagnostic, { process: 'electron-1', exitCode: null, exitSignal: 'SIGTRAP', stderrCategory: 'sandbox' });
    assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  });
  await test('display, shared-library and unknown startup failures have fixed diagnostic categories', () => {
    for (const [stderr, stderrCategory] of [
      ['Missing X server or $DISPLAY', 'display'],
      ['error while loading shared libraries: libgtk-3.so.0: cannot open shared object file', 'shared-library'],
      ['unrecognized startup failure with token-private@example.test', 'unknown'],
    ]) assert.deepEqual(nativeProcessDiagnostic({ name: 'electron-1', exitCode: 127, exitSignal: null }, stderr),
      { process: 'electron-1', exitCode: 127, exitSignal: null, stderrCategory });
  });
  await test('unknown diagnostic metadata cannot carry paths, credentials or arbitrary signal strings', () => {
    const diagnostic = nativeProcessDiagnostic({ name: 'private-token', exitCode: 'private-token', exitSignal: 'SIGTRAP private-token' }, 'private-token');
    assert.deepEqual(diagnostic, { process: 'unknown', exitCode: null, exitSignal: null, stderrCategory: 'unknown' });
    assert.equal(JSON.stringify(diagnostic).includes('private-token'), false);
  });
}

if (process.argv.includes('--self-test')) {
  await runtimePreparationTests();
} else {
const execute = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktop = join(root, 'desktop');
const platform = ({ win32: 'windows', darwin: 'macos', linux: 'linux' })[process.platform];
if (!platform) throw new Error('This native smoke supports Windows, macOS, and Linux.');
if (typeof WebSocket !== 'function') throw new Error('Run this smoke with Node.js 22 or newer.');

const qaDirectory = await mkdtemp(join(tmpdir(), 'hapark-ci-desktop-'));
const dataDirectory = join(qaDirectory, 'data');
const profileDirectory = join(qaDirectory, 'profile');
const artifacts = join(root, 'artifacts', `ci-desktop-smoke-${platform}`);
await Promise.all([dataDirectory, profileDirectory, artifacts].map(path => mkdir(path, { recursive: true })));
const evidenceFile = join(artifacts, 'result.json');
// These files are produced only by this script. Do not leave an earlier
// success screenshot beside a later failed run, or remove other QA artifacts.
await Promise.all(['pairing-empty.png', 'connected.png', 'resumed.png', 'recovery-pairing.png', 'recovered.png', 'failure.png', 'result.json'].map(async name => {
  await unlink(join(artifacts, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}));
const stop = new AbortController();
// Allow the official binary download its own 120s, in addition to app flows.
const overallTimer = setTimeout(() => stop.abort(), 240_000);
const interrupt = () => stop.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const children = [];
let connection;
let serverListening = false;
let failure;
let phase = 'runtime_check';
const evidence = {
  passed: false, platform, architecture: process.arch, qaDirectory,
  capturedAt: new Date().toISOString(),
  mode: 'real-electron-real-os-encryption-mock-api', build: 'unpackaged-ci',
  cliInferenceJobsOffered: 0, browserActionsInvoked: 0,
  visibleWindowRequested: false, protocolRegistrationRequested: false,
  mockKeychain: false, basicTextAllowed: false,
  checks: [], screenshots: [], providers: [], cleanup: {},
  runtime: { installationRequired: false, prepared: false, preparationTimeoutMs: 120_000 },
};
const attempts = new Map();
const deviceTokens = new Set();
const acknowledgedTokens = new Set();
const deviceFingerprints = new Set();
const launchTokens = new Map();
const attemptCodes = new Map();
const stats = { ack: 0, pair: 0, wrongCode: 0, heartbeat: 0, claim: 0, result: 0, strictRejected: 0, unexpected: 0 };
const deviceId = 'ci-device-1';
const lease = () => new Date(Date.now() + 45_000).toISOString();

function check(condition, message) { assert.ok(condition, message); }
function desktopAttempt(attemptId, connected) {
  return {
    attemptId, version: 1, status: connected ? 'connected' : 'awaiting_code',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    siteName: '하박조팽', teamName: 'CI 검증 팀', memberName: 'CI 연구자',
    deviceId: connected ? deviceId : null, leaseExpiresAt: connected ? lease() : null,
  };
}
function respond(response, status, data, code = 'INVALID_REQUEST') {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(status < 400 ? { data } : { error: { code, message: 'CI fixture response' } }));
}
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST') { stats.unexpected += 1; respond(response, 404); return; }
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1_000_000) throw new Error('Oversized fixture request');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (request.url === '/api/local-agent/desktop/ack') {
      if (!exactKeys(body, ['attemptId', 'launchToken', 'deviceToken', 'deviceName', 'platform'])
        || launchTokens.get(body.attemptId) !== body.launchToken
        || !/^[A-Za-z0-9_-]{43}$/.test(body.deviceToken ?? '')
        || body.platform !== platform || typeof body.deviceName !== 'string') {
        stats.strictRejected += 1; respond(response, 400); return;
      }
      stats.ack += 1; acknowledgedTokens.add(body.deviceToken);
      deviceFingerprints.add(createHash('sha256').update(body.deviceToken).digest('hex'));
      attempts.set(body.attemptId, { launchToken: body.launchToken, deviceToken: body.deviceToken });
      respond(response, 200, desktopAttempt(body.attemptId, deviceTokens.has(body.deviceToken))); return;
    }
    if (request.url === '/api/local-agent/desktop/pair') {
      const attempt = attempts.get(body.attemptId);
      if (!exactKeys(body, ['attemptId', 'launchToken', 'deviceToken', 'code']) || !attempt
        || attempt.launchToken !== body.launchToken || attempt.deviceToken !== body.deviceToken) {
        stats.strictRejected += 1; respond(response, 401); return;
      }
      stats.pair += 1;
      if (body.code !== attemptCodes.get(body.attemptId)) { stats.wrongCode += 1; respond(response, 400, null, 'WRONG_CODE'); return; }
      deviceTokens.add(body.deviceToken);
      respond(response, 200, desktopAttempt(body.attemptId, true)); return;
    }
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    if (!deviceTokens.has(token) || request.headers['x-local-agent-device'] !== deviceId) {
      stats.strictRejected += 1; respond(response, 401); return;
    }
    if (request.url === '/api/local-agent/desktop/heartbeat') {
      if (!validHeartbeatInput(body)) {
        stats.strictRejected += 1; respond(response, 400); return;
      }
      stats.heartbeat += 1;
      respond(response, 200, { leaseExpiresAt: lease(), cancelJobIds: [], heartbeatIntervalSeconds: 5 }); return;
    }
    if (request.url === '/api/local-agent/desktop/claim' && exactKeys(body, [])) {
      stats.claim += 1;
      // Never enqueue a job: even a locally installed, logged-in CLI cannot infer.
      respond(response, 200, null); return;
    }
    if (request.url === '/api/local-agent/desktop/result') stats.result += 1;
    stats.unexpected += 1; respond(response, 404);
  } catch { stats.strictRejected += 1; if (!response.headersSent) respond(response, 400); else response.destroy(); }
});

async function until(predicate, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (stop.signal.aborted) throw new Error('Native desktop smoke interrupted or timed out.');
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`Native desktop condition not reached: ${label}`);
}
function isAlive(record) { return record && !record.closed; }
async function exitWithin(record, milliseconds) {
  if (!isAlive(record)) return true;
  let timer;
  try { return await Promise.race([record.done.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function forceStop(record) {
  if (!isAlive(record)) return;
  if (process.platform === 'win32') {
    try { await execute('taskkill.exe', ['/PID', String(record.child.pid), '/T', '/F'], { windowsHide: true, shell: false, timeout: 15_000 }); }
    catch { if (isAlive(record)) throw new Error('Could not terminate the owned Electron process tree.'); }
  } else {
    // The child starts a new process group. DBus/keyring belong to the CI parent,
    // so never search process names, kill ports, or signal the parent group.
    try { process.kill(-record.child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw new Error('Could not terminate the owned Electron process group.'); }
  }
  check(await exitWithin(record, 10_000), 'Owned Electron process did not exit after termination.');
}
async function quitOwned(record) {
  await connection.js('window.connector.quit()').catch(() => {});
  check(await exitWithin(record, 10_000), 'Owned Electron must exit through the app quit action before relaunch.');
  connection.close(); connection = undefined;
}
async function spawnOwned(command, args, name) {
  const out = await open(join(qaDirectory, `${name}.stdout.log`), 'a');
  const stderrPath = join(qaDirectory, `${name}.stderr.log`);
  const err = await open(stderrPath, 'a');
  const environment = { ...process.env };
  // Electron must launch as Electron even when the orchestrator itself is Node.
  // No credential/CLI environment overrides are introduced.
  delete environment.ELECTRON_RUN_AS_NODE;
  let record;
  try {
    const child = spawn(command, args, {
      cwd: desktop, env: environment, windowsHide: true, shell: false,
      detached: process.platform !== 'win32', stdio: ['ignore', out.fd, err.fd],
    });
    record = { child, name, stderrPath, closed: false, exitCode: null, exitSignal: null };
    record.done = new Promise(resolve => child.once('close', (code, signal) => { record.exitCode = code; record.exitSignal = signal; record.closed = true; resolve(); }));
    children.push(record);
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('Could not launch the installed Electron runtime.'))); });
  } finally { await out.close(); await err.close(); }
  return record;
}
async function ownedProcessDiagnostics(records) {
  return Promise.all(records.map(async record => {
    let handle, stderr = '', stderrCaptured = false;
    try {
      handle = await open(record.stderrPath, 'r');
      const { size } = await handle.stat();
      const buffer = Buffer.alloc(Math.min(size, 16 * 1024));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      stderr = buffer.subarray(0, bytesRead).toString('utf8'); stderrCaptured = true;
    } catch {} finally { if (handle) await handle.close().catch(() => {}); }
    // Raw logs remain in the owned Temp directory. Artifacts contain fixed enums only.
    return { ...nativeProcessDiagnostic(record, stderr), stderrCaptured };
  }));
}
async function launch(electron, sequence) {
  // This file belongs only to this newly created profile. Remove its stale CDP
  // pointer after the previous owned process exits, never a user browser file.
  await unlink(join(dataDirectory, 'DevToolsActivePort')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const attemptId = `ci-attempt-${sequence}`;
  const launchToken = randomBytes(32).toString('base64url'); launchTokens.set(attemptId, launchToken);
  attemptCodes.set(attemptId, sequence === 3 ? '716204' : '482107');
  const args = [desktop, '--connector-dev', '--no-auto-open', '--connector-qa',
    `--connector-data-dir=${dataDirectory}`, `--user-data-dir=${profileDirectory}`,
    '--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []),
    `hapark-connect://connect?attemptId=${attemptId}&launchToken=${launchToken}`];
  return spawnOwned(electron, args, `electron-${sequence}`);
}

async function attach(record) {
  let target;
  const rendererUrl = pathToFileURL(join(desktop, 'renderer', 'index.html')).href;
  await until(async () => {
    check(isAlive(record), 'Owned Electron exited before its renderer became ready.');
    try {
      const port = Number((await readFile(join(dataDirectory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) return false;
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
      const targets = await response.json();
      target = targets.find(value => value.type === 'page' && value.url === rendererUrl);
      return target?.webSocketDebuggerUrl?.startsWith(`ws://127.0.0.1:${port}/`);
    } catch { return false; }
  }, 'owned renderer debugging endpoint', 25_000);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0; const pending = new Map();
  const rejectPending = () => { for (const item of pending.values()) item.reject(new Error('Owned renderer disconnected.')); pending.clear(); };
  socket.addEventListener('close', rejectPending);
  socket.addEventListener('error', rejectPending);
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data); const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error('Owned renderer rejected a CDP command.')); else item.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Owned renderer CDP connection timed out.')); }, 8_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Owned renderer CDP connection failed.')); }, { once: true });
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Owned renderer command timed out: ${method}`)); }, 8_000);
    pending.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const js = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    check(!result.exceptionDetails, 'Owned renderer evaluation failed.');
    return result.result.value;
  };
  const screenshot = async name => {
    const capture = await command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const bytes = Buffer.from(capture.data, 'base64');
    await Promise.all([writeFile(join(artifacts, `${name}.png`), bytes), writeFile(join(qaDirectory, `${name}.png`), bytes)]);
    evidence.screenshots.push(`${name}.png`);
  };
  const typeCode = async text => {
    await js("document.querySelector('#code').focus();document.querySelector('#code').select()");
    await command('Input.insertText', { text });
  };
  const click = async selector => {
    await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center',behavior:'instant'})`);
    await until(() => js(`(()=>{
      const target=document.querySelector(${JSON.stringify(selector)}), r=target.getBoundingClientRect();
      const x=r.x+r.width/2, y=r.y+r.height/2, hit=document.elementFromPoint(x,y);
      return !target.disabled && r.width>0 && r.height>0 && x>=0 && x<innerWidth && y>=0 && y<innerHeight
        && (hit===target || target.contains(hit));
    })()`), 'visible enabled click target');
    const box = await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...box });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...box });
  };
  const stage = async expected => until(async () => {
    check(isAlive(record), 'Owned Electron exited during the native flow.');
    const value = await js(`(async()=>{const value=await window.connector.state();return {
      stage:value.stage,
      cause:value.stage !== 'error' ? null : value.description.startsWith('OS 보안 저장소') ? 'os-storage-unavailable'
        : /저장한 연결 정보를 (읽지|열지)/.test(value.description) ? 'stored-identity-decryption-failed'
        : value.description.includes('저장한 연결 정보를 확인하지') ? 'stored-identity-invalid' : 'connection-or-storage-error'
    }})()`);
    if (value.stage === 'error') {
      evidence.failureStage = { expected, cause: value.cause };
      await screenshot('failure');
      throw new Error(`Native app reported ${value.cause}. Check the OS keyring and retained Electron logs.`);
    }
    return value.stage === expected;
  }, `app stage ${expected}`);
  await until(() => js("typeof window.connector?.state === 'function' && document.readyState === 'complete' && document.querySelector('#code') && document.querySelector('#activity-label') && [...document.images].every(image => image.complete && image.naturalWidth > 0)"), 'isolated preload bridge');
  return { js, screenshot, typeCode, click, stage, close: () => { socket.close(); rejectPending(); } };
}
async function encryptedEnvelope() {
  const raw = await readFile(join(dataDirectory, 'devices.enc.json'), 'utf8');
  const envelope = JSON.parse(raw);
  check(envelope.version === 1 && typeof envelope.data === 'string' && envelope.data.length > 32, 'Actual OS encrypted credential envelope was not written.');
  const ciphertext = Buffer.from(envelope.data, 'base64');
  for (const token of acknowledgedTokens) {
    check(!raw.includes(token) && !ciphertext.includes(Buffer.from(token)), 'Credential file contains a plaintext device key.');
  }
  check(!ciphertext.includes(Buffer.from('deviceToken')) && !ciphertext.includes(Buffer.from(deviceId)), 'Credential envelope exposes plaintext identity fields.');
  // Do not decrypt, print, or publish credentials or ciphertext. Product
  // safeStorage availability + Linux basic_text guard run before this save.
  return { version: envelope.version, ciphertextBytes: ciphertext.length, plaintextIdentityAbsent: true };
}
async function unreadableBackups() {
  return (await readdir(dataDirectory)).filter(name => /^devices\.enc\.json\.unreadable-[0-9a-f-]+\.enc\.bak$/.test(name));
}
async function providerSummary() {
  await until(() => connection.js("(async()=> (await window.connector.state()).providers.length === 2)()"), 'CLI metadata detection (installation is optional)', 45_000);
  const providers = await connection.js(`(async()=> (await window.connector.state()).providers.map(value => ({
    provider:value.provider, status:value.status, modelCount:value.models.length
  })))()`);
  check(providers.every(value => ['codex', 'claude'].includes(value.provider)
    && ['ready', 'not_installed', 'login_required', 'limited', 'error'].includes(value.status)), 'Unrecognized CLI metadata status.');
  const missing = providers.filter(value => value.status === 'not_installed').length;
  if (missing) {
    const visibleHelp = await connection.js(`Array.from(document.querySelectorAll('.provider')).filter(row =>
      row.querySelector('.provider-state')?.textContent === '설치 필요' && !!row.querySelector('button.text-button')).length`);
    check(visibleHelp === missing, 'Missing CLIs must show installation guidance without opening a browser.');
  }
  return providers;
}

try {
  const electron = await prepareElectronRuntime({
    packageDirectory: join(desktop, 'node_modules', 'electron'),
    readPath: path => readFile(path, 'utf8'), verifyExecutable: path => access(path),
    install: async installer => {
      phase = 'runtime_install'; evidence.runtime.installationRequired = true;
      await access(installer);
      const preparation = await spawnOwned(process.execPath, [installer], 'electron-runtime-install');
      await until(() => preparation.closed, 'official Electron runtime preparation', 120_000);
      if (preparation.child.exitCode !== 0) throw Object.assign(new Error('Native Electron runtime preparation failed.'), { code: 'ELECTRON_INSTALL_FAILED' });
      phase = 'runtime_verify';
    },
  });
  evidence.runtime.prepared = true; phase = 'fixture_start';
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error('Loopback fixture port 3000 is unavailable; no existing process was changed.')));
    server.listen(3000, '127.0.0.1', () => { serverListening = true; resolve(); });
  });
  phase = 'initial_pairing';
  const first = await launch(electron, 1); connection = await attach(first); await connection.stage('pairing');
  const baseline = await connection.js(`({empty:document.querySelector('#code').value === '', disabled:document.querySelector('#pair-button').disabled,
    autoStart:document.querySelector('#auto-start').checked, pet:document.querySelector('#pet').checked, nodeExposed:typeof window.require !== 'undefined'})`);
  check(baseline.empty && baseline.disabled && !baseline.autoStart && !baseline.pet && !baseline.nodeExposed, 'Initial app must have an empty code, no defaults, and an isolated renderer.');
  await connection.screenshot('pairing-empty'); evidence.checks.push('empty-code-disabled-no-defaults-isolated-renderer');
  await connection.typeCode('12345');
  check(await connection.js("document.querySelector('#pair-button').disabled"), 'Five digits must not enable pairing.');
  check(stats.pair === 0, 'Empty or short code must not submit a pairing request.');
  evidence.checks.push('five-digits-blocked-without-api-request');
  await connection.typeCode('123456'); await connection.click('#pair-button');
  await until(() => connection.js("document.querySelector('#code-error').textContent.includes('번호가 맞지')"), 'wrong six-digit code feedback');
  check(stats.pair === 1 && stats.wrongCode === 1, 'Wrong code must cause exactly one rejected request.');
  evidence.checks.push('wrong-six-digit-code-rejected');
  await connection.typeCode('482107'); await connection.click('#pair-button'); await connection.stage('connected');
  phase = 'initial_metadata';
  evidence.providers = await providerSummary();
  await until(() => stats.heartbeat > 0 && stats.claim > 0, 'authenticated heartbeat and empty job queue');
  evidence.storage = await encryptedEnvelope(); await connection.screenshot('connected');
  check(stats.ack === 1 && stats.pair === 2 && acknowledgedTokens.size === 1, 'Initial pairing did not use one stable device identity.');
  evidence.checks.push('correct-code-connected', 'native-os-encrypted-store-without-plaintext-key', 'optional-cli-installation-status-visible');

  // Exercise the product's ordinary App Quit UX so Chromium can flush its OS
  // encrypted key. Forced termination is reserved for owned-process cleanup;
  // this smoke does not claim that first-run crash recovery was verified.
  await quitOwned(first);
  evidence.resumeExitMode = 'graceful-app-quit';
  evidence.checks.push('app-quit-exited-owned-electron-before-relaunch');
  phase = 'normal_resume';
  const previousPair = stats.pair, previousHeartbeat = stats.heartbeat;
  const second = await launch(electron, 2); connection = await attach(second); await connection.stage('connected');
  await until(() => stats.heartbeat > previousHeartbeat, 'resumed authenticated heartbeat');
  await providerSummary(); await encryptedEnvelope();
  check(stats.ack === 2 && stats.pair === previousPair && acknowledgedTokens.size === 1, 'Cold restart must decrypt the same device key and connect without another code.');
  check(await connection.js("document.querySelector('#pairing').hidden && document.querySelector('#code').value === ''"), 'Resumed app must not request another code.');
  await connection.screenshot('resumed');
  evidence.checks.push('same-profile-cold-restart-decrypts-same-identity', 'reconnect-without-code-or-additional-pair');
  await quitOwned(second);
  check((await unreadableBackups()).length === 0, 'Normal encrypted-store resume must not create an unreadable backup.');
  phase = 'ciphertext_recovery';

  // Only this script's fresh temporary encrypted file is changed. Keep the
  // envelope valid and flip one bit of one byte of its opaque base64 payload;
  // do not expose, decrypt, or replace any credential with a plaintext mock.
  const encryptedFile = join(dataDirectory, 'devices.enc.json');
  const savedEnvelope = JSON.parse(await readFile(encryptedFile, 'utf8'));
  const corruptedCiphertext = Buffer.from(savedEnvelope.data, 'base64');
  check(corruptedCiphertext.length > 32, 'Owned encrypted payload is too short for the recovery regression.');
  corruptedCiphertext[0] ^= 1;
  const corruptedEnvelope = Buffer.from(JSON.stringify({ ...savedEnvelope, data: corruptedCiphertext.toString('base64') }));
  await writeFile(encryptedFile, corruptedEnvelope, { mode: 0o600 });
  const pairBeforeRecovery = stats.pair, heartbeatBeforeRecovery = stats.heartbeat;
  const third = await launch(electron, 3); connection = await attach(third); await connection.stage('pairing');
  check(stats.ack === 3 && stats.pair === pairBeforeRecovery && acknowledgedTokens.size === 2,
    'Unreadable storage must generate a new identity and require pairing instead of reusing the old approval.');
  check(await connection.js("!document.querySelector('#pairing').hidden && document.querySelector('#code').value === '' && document.querySelector('#pair-button').disabled"),
    'Recovered identity must start with an empty disabled six-digit pairing form.');
  const backups = await unreadableBackups();
  check(backups.length === 1, 'Unreadable encrypted envelope must be preserved in exactly one backup.');
  check((await readFile(join(dataDirectory, backups[0]))).equals(corruptedEnvelope), 'Unreadable backup must preserve the original damaged envelope bytes.');
  await encryptedEnvelope(); await connection.screenshot('recovery-pairing');
  evidence.checks.push('damaged-encrypted-store-requires-empty-code-new-identity', 'damaged-envelope-preserved-byte-for-byte-once');
  await connection.typeCode('716204'); await connection.click('#pair-button'); await connection.stage('connected');
  await until(() => stats.heartbeat > heartbeatBeforeRecovery, 'new identity authenticated heartbeat after recovery');
  await encryptedEnvelope();
  check(stats.pair === pairBeforeRecovery + 1 && acknowledgedTokens.size === 2 && (await unreadableBackups()).length === 1,
    'Recovery must pair the new identity exactly once without rotating or duplicating its backup.');
  check((await readFile(join(dataDirectory, backups[0]))).equals(corruptedEnvelope), 'Recovery pairing must keep the unreadable encrypted backup unchanged.');
  await connection.screenshot('recovered');
  evidence.recovery = { corruptedPayloadBytes: 1, changedBits: 1, autoApprovedOldIdentity: false, newPairRequests: 1,
    uniqueDeviceCredentials: acknowledgedTokens.size, uniqueDeviceFingerprints: deviceFingerprints.size,
    unreadableBackups: backups.length, backupMatchesOriginalDamagedEnvelope: true };
  evidence.checks.push('new-six-digit-code-recovers-encrypted-identity', 'recovery-keeps-single-opaque-backup');
  check(stats.result === 0 && stats.strictRejected === 0 && stats.unexpected === 0, 'Fixture received an inference result, invalid DTO, or unexpected request.');
} catch (error) {
  // Fixed assertion messages only. Do not emit raw API payloads, CLI output,
  // launch tokens, stack traces, environment values, or full app state.
  failure = error instanceof assert.AssertionError || (error instanceof Error && /^(Native |Owned |Could not |Loopback |Run this |This native)/.test(error.message))
    ? error.message : 'Native desktop smoke failed; inspect the retained owned Electron logs.';
  evidence.failedStage = phase;
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)) evidence.errorCode = error.code;
} finally {
  clearTimeout(overallTimer);
  for (const record of children.slice().reverse()) {
    try {
      if (isAlive(record) && connection) {
        await connection.js('window.connector.quit()').catch(() => {});
        await exitWithin(record, 5_000);
      }
      await forceStop(record);
    } catch { if (!failure) evidence.failedStage = 'cleanup'; failure ??= 'Owned Electron cleanup did not complete.'; }
  }
  connection?.close();
  if (serverListening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  evidence.cleanup = { ownedPids: children.map(record => record.child.pid).filter(Boolean), allOwnedAppsExited: children.every(record => record.closed), loopbackClosed: !server.listening, temporaryProfileRetained: true, keyringOrDbusTerminated: false };
  evidence.processDiagnostics = await ownedProcessDiagnostics(children);
  evidence.stats = { ...stats, uniqueDeviceCredentials: acknowledgedTokens.size, uniqueDeviceFingerprints: deviceFingerprints.size };
  evidence.passed = !failure && evidence.cleanup.allOwnedAppsExited && evidence.cleanup.loopbackClosed;
  evidence.stage = evidence.passed ? 'complete' : evidence.failedStage ?? phase;
  if (failure) evidence.error = failure;
  await Promise.all([writeFile(evidenceFile, JSON.stringify(evidence, null, 2)), writeFile(join(qaDirectory, 'result.json'), JSON.stringify(evidence, null, 2))]);
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  console.log(JSON.stringify({ passed: evidence.passed, platform, evidence: evidenceFile, retainedTemporaryDirectory: qaDirectory, ...(failure ? { error: failure } : {}) }));
  if (!evidence.passed) process.exitCode = 1;
}
}
