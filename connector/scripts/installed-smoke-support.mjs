import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function assertInside(candidate, parent) {
  const syntax = candidate.startsWith('/') && parent.startsWith('/') ? path.posix : path;
  assert.ok(syntax.isAbsolute(candidate) && syntax.isAbsolute(parent), 'Absolute owned paths required');
  const resolved = syntax.resolve(candidate), relative = syntax.relative(syntax.resolve(parent), resolved);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${syntax.sep}`) && !syntax.isAbsolute(relative), 'Path escaped its owner');
  return resolved;
}

export function validateRunnerContext(env, { platform, uid, workspace }) {
  assert.ok(['linux', 'darwin'].includes(platform), 'Only native macOS/Linux runners are supported');
  assert.equal(env.CI, 'true'); assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'Self-hosted runners are not disposable');
  assert.equal(env.LOCAL_AGENT_INSTALL_QA, '1');
  assert.equal(env.RUNNER_OS, platform === 'darwin' ? 'macOS' : 'Linux');
  assert.ok(Number.isSafeInteger(uid) && uid > 0, 'Run the application as the non-root hosted runner');
  assert.ok(typeof env.GITHUB_WORKSPACE === 'string' && path.posix.isAbsolute(env.GITHUB_WORKSPACE));
  assert.equal(path.posix.resolve(env.GITHUB_WORKSPACE), path.posix.resolve(workspace));
  assert.ok(typeof env.RUNNER_TEMP === 'string' && path.posix.isAbsolute(env.RUNNER_TEMP));
  const runnerTemp = path.posix.resolve(env.RUNNER_TEMP), normalizedWorkspace = path.posix.resolve(workspace);
  assert.notEqual(runnerTemp, '/'); assert.notEqual(normalizedWorkspace, '/');
  assert.ok(runnerTemp !== normalizedWorkspace && !runnerTemp.startsWith(`${normalizedWorkspace}/`), 'Runner temp must be separate');
  return { workspace: normalizedWorkspace, runnerTemp };
}

export function validateConfiguration(value) {
  assert.ok(value && /^[a-zA-Z][a-zA-Z0-9_.-]{3,199}$/.test(value.appId ?? ''));
  assert.ok(typeof value.productName === 'string' && value.productName.length <= 100 && value.productName.trim()
    && !/[<>:"/\\|?*\u0000-\u001f]/.test(value.productName) && !['.', '..'].includes(value.productName));
  assert.ok(typeof value.macBundleName === 'string' && value.macBundleName.length <= 100 && value.macBundleName.trim()
    && !/[<>:"/\\|?*\u0000-\u001f]/.test(value.macBundleName) && !['.', '..'].includes(value.macBundleName));
  assert.ok(/^[a-z][a-z0-9+.-]{2,63}$/.test(value.scheme ?? '') && !['http', 'https', 'file', 'data', 'javascript'].includes(value.scheme));
  assert.ok(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]+)?$/.test(value.packageVersion ?? ''));
  return value;
}

export function selectPackageName(names, platform, architecture) {
  assert.ok(['linux', 'darwin'].includes(platform));
  assert.ok(platform === 'linux' ? architecture === 'x64' : ['arm64', 'x64'].includes(architecture));
  const candidates = names.filter(name => platform === 'darwin' ? name.endsWith(`-${architecture}.dmg`) : name.endsWith('.deb'));
  assert.equal(candidates.length, 1, 'Exactly one native candidate package is required');
  assert.equal(path.posix.basename(candidates[0]), candidates[0]);
  assert.ok(!candidates[0].includes('\\') && !/[\u0000-\u001f]/.test(candidates[0]));
  return candidates[0];
}

export async function loadConfiguration(connectorRoot) {
  const desktop = path.join(connectorRoot, 'desktop');
  const pkg = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
  const portableProfile = !pkg.build?.appId;
  let build = pkg.build;
  if (!build?.appId) build = JSON.parse(await readFile(path.join(desktop, 'builder.generated.json'), 'utf8'));
  const runtime = JSON.parse(await readFile(path.join(desktop, 'apps.generated.json'), 'utf8'));
  assert.equal(runtime.development, false, 'Installed smoke requires the production build configuration');
  assert.equal(runtime.applications?.length, 1);
  const productName = build.productName ?? pkg.productName;
  return validateConfiguration({ appId: build.appId, productName,
    macBundleName: build.mac?.executableName ?? build.executableName ?? productName,
    scheme: runtime.applications[0].scheme, packageVersion: build.extraMetadata?.version ?? pkg.version, connectorRoot,
    packageName: build.deb?.packageName ?? build.extraMetadata?.name ?? pkg.name,
    profileRelativePath: portableProfile ? [build.appId, 'production'] : [] });
}

export async function createOwnedDirectory(parent, prefix) {
  assert.match(prefix, /^[a-z][a-z0-9-]{2,59}$/);
  const ownerRoot = await realpath(parent), directory = await mkdtemp(path.join(ownerRoot, prefix));
  assertInside(directory, ownerRoot);
  const token = randomUUID(), marker = path.join(directory, '.connector-install-owner');
  await writeFile(marker, token, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return { path: directory, async cleanup() {
    assertInside(directory, ownerRoot);
    assert.ok(!(await lstat(directory)).isSymbolicLink());
    assert.equal(await realpath(directory), directory);
    assert.ok(!(await lstat(marker)).isSymbolicLink());
    assert.equal(await readFile(marker, 'utf8'), token, 'Ownership marker changed; preserve the directory');
    await rm(directory, { recursive: true });
  } };
}

export async function fileHash(file) {
  assert.ok((await lstat(file)).isFile() && !(await lstat(file)).isSymbolicLink(), 'Expected a regular candidate file');
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function verifyInstalledCore(resourcesDir, sourceCoreDir) {
  const installed = path.join(resourcesDir, 'core');
  const directory = await lstat(installed);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink(), 'Installed core must be a real packaged directory');
  const sourceNames = (await readdir(sourceCoreDir)).filter(name => name.endsWith('.mjs')).sort();
  const actualNames = (await readdir(installed)).filter(name => name.endsWith('.mjs')).sort();
  assert.ok(sourceNames.length > 0); assert.deepEqual(actualNames, sourceNames, 'Installed core set differs');
  const hashes = {};
  for (const name of sourceNames) {
    const sourceHash = await fileHash(path.join(sourceCoreDir, name));
    assert.equal(await fileHash(path.join(installed, name)), sourceHash, `Installed core mismatch: ${name}`);
    hashes[name] = sourceHash;
  }
  return { count: sourceNames.length, hashes };
}

export function diagnostic(error, phase) {
  const result = { phase: /^[a-z][a-z0-9_]{0,59}$/.test(phase ?? '') ? phase : 'unknown',
    code: /^[A-Z][A-Z0-9_]{1,59}$/.test(error?.code ?? '') ? error.code : 'UNKNOWN' };
  const site = typeof error?.stack === 'string' && /\n\s+at[^\n]*[/\\](ci-installed-(?:linux|macos|windows|smoke)\.mjs|installed-smoke-support\.mjs):([1-9]\d{0,5}):([1-9]\d{0,4})/.exec(error.stack.slice(0, 20_000));
  if (site) result.site = { file: site[1], line: Number(site[2]), column: Number(site[3]) };
  return result;
}

export async function run(file, args, { timeout = 30_000, allowFailure = false, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, shell: false,
      env: env ? { ...process.env, ...env } : process.env, encoding: 'utf8' }, (error, stdout, stderr) => {
      const result = { stdout, stderr, code: error ? (Number.isInteger(error.code) ? error.code : 127) : 0 };
      if (error && !allowFailure) reject(Object.assign(new Error('Native installer command failed'), {
        code: typeof error.code === 'string' ? error.code : 'COMMAND_FAILED', command: path.basename(file), result,
      }));
      else resolve(result);
    });
  });
}

export function start(file, args, { env } = {}) {
  const child = spawn(file, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env });
  const record = { child, pid: child.pid, closed: false, stderr: '' };
  child.stdout.resume();
  child.stderr.on('data', chunk => { record.stderr = (record.stderr + chunk.toString()).slice(-8000); });
  record.done = new Promise(resolve => {
    child.once('error', error => { record.closed = true; resolve({ code: null, signal: null, error: diagnostic(error, 'spawn') }); });
    child.once('close', (code, signal) => { record.closed = true; resolve({ code, signal }); });
  });
  return record;
}

export async function until(predicate, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Object.assign(new Error(`Installed application condition was not reached: ${label}`), { code: 'CONDITION_TIMEOUT' });
}

export async function reserveDebugPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export function matchesInstalledRendererUrl(value, rendererFile, { platform = process.platform } = {}) {
  try {
    if (typeof value !== 'string' || !path.isAbsolute(rendererFile)) return false;
    const url = new URL(value);
    if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) return false;
    const actual = fileURLToPath(url), expected = path.resolve(rendererFile);
    return platform === 'darwin' ? actual.normalize('NFC') === expected.normalize('NFC') : actual === expected;
  } catch { return false; }
}

export function selectInstalledProcessInfo(value) {
  assert.ok(Array.isArray(value?.processInfo) && value.processInfo.length > 0 && value.processInfo.length <= 1000);
  const ids = new Set(), types = new Set(['browser', 'renderer', 'GPU', 'gpu', 'gpu-process', 'utility', 'network-service', 'worker']);
  return value.processInfo.map(entry => {
    assert.ok(Number.isSafeInteger(entry?.id) && entry.id > 0 && entry.id <= 0xffffffff && !ids.has(entry.id));
    ids.add(entry.id);
    return { id: entry.id, type: types.has(entry.type) ? entry.type : 'other' };
  });
}

async function connectInstalledDebugger(webSocketDebuggerUrl, port) {
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  const debuggerUrl = new URL(webSocketDebuggerUrl);
  assert.equal(debuggerUrl.protocol, 'ws:'); assert.equal(debuggerUrl.hostname, '127.0.0.1');
  assert.equal(debuggerUrl.port, String(port)); assert.ok(!debuggerUrl.username && !debuggerUrl.password);
  assert.ok(!debuggerUrl.search && !debuggerUrl.hash);
  assert.match(debuggerUrl.pathname, /^\/devtools\/(?:page|browser)\/[a-zA-Z0-9-]+$/);
  const socket = new WebSocket(debuggerUrl);
  let nextId = 0, closed = false;
  const pending = new Map();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Object.assign(new Error('CDP did not open'), { code: 'CDP_UNAVAILABLE' })); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Object.assign(new Error('CDP did not open'), { code: 'CDP_UNAVAILABLE' })); }, { once: true });
  });
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data)), request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id); clearTimeout(request.timer);
    if (value.error) request.reject(Object.assign(new Error('Installed CDP command failed'), { code: 'CDP_COMMAND_FAILED' }));
    else request.resolve(value.result);
  });
  socket.addEventListener('close', () => {
    closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Object.assign(new Error('Installed app closed'), { code: 'APP_CLOSED' })); }
    pending.clear();
  });
  const command = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    if (closed) { reject(Object.assign(new Error('Installed app closed'), { code: 'APP_CLOSED' })); return; }
    const timer = setTimeout(() => { pending.delete(id); reject(Object.assign(new Error('CDP command timed out'), { code: 'CDP_TIMEOUT' })); }, 10_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { command, close: () => socket.close() };
}

export async function getInstalledBrowserProcesses(port) {
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
  assert.ok(response.ok);
  const version = await response.json();
  assert.ok(new URL(version.webSocketDebuggerUrl).pathname.startsWith('/devtools/browser/'));
  const socket = await connectInstalledDebugger(version.webSocketDebuggerUrl, port);
  try { return selectInstalledProcessInfo(await socket.command('SystemInfo.getProcessInfo', {})); }
  finally { socket.close(); }
}

export async function connectInstalledApp(port, rendererFile, { diagnostics = {} } = {}) {
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  const expected = pathToFileURL(rendererFile).href;
  const target = await until(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      diagnostics.httpStatus = response.status;
      if (!response.ok) return false;
      const values = await response.json();
      assert.ok(Array.isArray(values));
      const pages = values.filter(value => value.type === 'page');
      diagnostics.pageTargets = pages.length;
      diagnostics.exactUrlMatched = pages.some(value => value.url === expected);
      diagnostics.installedFileMatched = pages.some(value => matchesInstalledRendererUrl(value.url, rendererFile));
      return pages.find(value => matchesInstalledRendererUrl(value.url, rendererFile)) ?? false;
    } catch { return false; }
  }, 'the exact installed renderer CDP target', 30_000);
  const client = await connectInstalledDebugger(target.webSocketDebuggerUrl, port);
  const command = client.command;
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!result.exceptionDetails, 'Installed renderer evaluation failed');
    return result.result.value;
  };
  return { evaluate, close: client.close,
    state: () => evaluate(`(async()=>{const s=await window.connector.state();return {stage:s.stage,title:s.title,description:s.description,attemptId:s.attemptId,providers:s.providers.map(p=>({provider:p.provider,status:p.status})),autoStart:s.autoStart,pet:s.pet}})()`),
    async quit() { try { await evaluate('void window.connector.quit(); true'); } catch (error) { if (error.code !== 'APP_CLOSED') throw error; } },
  };
}
