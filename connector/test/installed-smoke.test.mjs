import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateRunnerContext, assertInside, validateConfiguration, selectPackageName,
  createOwnedDirectory, verifyInstalledCore, diagnostic,
  loadConfiguration,
} from '../scripts/installed-smoke-support.mjs';

const runner = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', LOCAL_AGENT_INSTALL_QA: '1', GITHUB_WORKSPACE: '/work/repo', RUNNER_TEMP: '/work/_temp' };
const options = { platform: 'linux', uid: 1001, workspace: '/work/repo' };

test('installed package mutations require an explicit disposable hosted runner', () => {
  assert.deepEqual(validateRunnerContext(runner, options), { workspace: '/work/repo', runnerTemp: '/work/_temp' });
  for (const change of [{ CI: 'false' }, { GITHUB_ACTIONS: '' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { LOCAL_AGENT_INSTALL_QA: '' }, { RUNNER_OS: 'macOS' }]) {
    assert.throws(() => validateRunnerContext({ ...runner, ...change }, options));
  }
  assert.throws(() => validateRunnerContext(runner, { ...options, uid: 0 }));
  assert.throws(() => validateRunnerContext(runner, { ...options, platform: 'win32' }));
  assert.throws(() => validateRunnerContext(runner, { ...options, workspace: '/work/other' }));
});

test('a runner temp outside a normal absolute path or inside the workspace is rejected', () => {
  for (const RUNNER_TEMP of ['/', '.', '/work/repo', '/work/repo/dist', '/work/repo/../repo']) {
    assert.throws(() => validateRunnerContext({ ...runner, RUNNER_TEMP }, options));
  }
  assert.throws(() => assertInside('/work/owned/../other', '/work/owned'));
  assert.throws(() => assertInside('/work/owned-other/file', '/work/owned'));
  assert.throws(() => assertInside('/work/owned', '/work/owned'));
  assert.equal(assertInside('/work/owned/file', '/work/owned'), '/work/owned/file');
});

const build = { appId: 'org.example.connector', productName: '연구 연결기', macBundleName: '연구 연결기', packageVersion: '0.1.0', scheme: 'research-connect' };

test('configuration has no fallback app and cannot escape an installation filename', () => {
  assert.deepEqual(validateConfiguration(build), build);
  for (const override of [{ appId: '' }, { productName: '../Escape' }, { productName: '.' }, { productName: 'a\\b' }, { macBundleName: '' }, { macBundleName: '../Escape' }, { macBundleName: 'a\\b' }, { scheme: 'https' }, { scheme: 'file' }, { scheme: 'x:../' }, { packageVersion: '' }]) {
    assert.throws(() => validateConfiguration({ ...build, ...override }));
  }
});

test('only the exact current architecture DMG or one Debian file can be selected', () => {
  const names = ['connector-0.1.0-mac-arm64.dmg', 'connector-0.1.0-mac-x64.dmg'];
  assert.equal(selectPackageName(names, 'darwin', 'arm64'), names[0]);
  assert.equal(selectPackageName(names, 'darwin', 'x64'), names[1]);
  assert.throws(() => selectPackageName(names, 'darwin', 'riscv64'));
  assert.throws(() => selectPackageName([...names, 'old-mac-arm64.dmg'], 'darwin', 'arm64'));
  assert.throws(() => selectPackageName(['../escape.deb'], 'linux', 'x64'));
  assert.equal(selectPackageName(['one.deb'], 'linux', 'x64'), 'one.deb');
  assert.throws(() => selectPackageName(['one.deb', 'two.deb'], 'linux', 'x64'));
  assert.throws(() => selectPackageName(['one.AppImage'], 'linux', 'x64'));
});

test('packaged QA uses the real portable production profile and refuses development metadata', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'connector-config-unit-'));
  try {
    const desktop = join(parent, 'desktop'); await mkdir(desktop);
    const runtime = { development: false, applications: [{ scheme: build.scheme }] };
    const save = (name, value) => writeFile(join(desktop, name), JSON.stringify(value));
    await save('package.json', { name: 'fixture-desktop', productName: build.productName, version: build.packageVersion, build: { appId: build.appId } });
    await save('apps.generated.json', runtime);
    assert.deepEqual((await loadConfiguration(parent)).profileRelativePath, []);
    assert.equal((await loadConfiguration(parent)).packageName, 'fixture-desktop');
    await save('package.json', { name: 'fixture-desktop', version: build.packageVersion, build: {} });
    await save('builder.generated.json', { appId: build.appId, productName: build.productName, extraMetadata: { name: 'second-host-desktop' } });
    assert.deepEqual((await loadConfiguration(parent)).profileRelativePath, [build.appId, 'production']);
    assert.equal((await loadConfiguration(parent)).packageName, 'second-host-desktop');
    await save('apps.generated.json', { ...runtime, development: true });
    await assert.rejects(loadConfiguration(parent));
  } finally { assertInside(parent, tmpdir()); await rm(parent, { recursive: true, force: true }); }
});

test('installed macOS bundle identity follows the builder executable name while keeping the display brand', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'connector-config-mac-'));
  try {
    const desktop = join(parent, 'desktop'); await mkdir(desktop);
    const save = (name, value) => writeFile(join(desktop, name), JSON.stringify(value));
    await save('package.json', { name: 'fixture-desktop', version: '0.1.0' });
    await save('apps.generated.json', { development: false, applications: [{ scheme: build.scheme }] });
    const generated = { appId: build.appId, productName: build.productName, executableName: 'research-notebook-connector' };
    await save('builder.generated.json', generated);
    const global = await loadConfiguration(parent);
    assert.equal(global.macBundleName, 'research-notebook-connector');
    assert.equal(global.productName, build.productName);
    await save('builder.generated.json', { ...generated, mac: { executableName: 'native-mac-connector' } });
    assert.equal((await loadConfiguration(parent)).macBundleName, 'native-mac-connector');
    await save('builder.generated.json', { ...generated, mac: { executableName: '../another-app' } });
    await assert.rejects(loadConfiguration(parent));
    await save('builder.generated.json', { ...generated, executableName: undefined });
    assert.equal((await loadConfiguration(parent)).macBundleName, build.productName);
  } finally { assertInside(parent, tmpdir()); await rm(parent, { recursive: true, force: true }); }
});

test('only a marked owned directory can be recursively cleaned and an altered marker is retained', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'connector-install-unit-'));
  try {
    const owned = await createOwnedDirectory(parent, 'owned-');
    await writeFile(join(owned.path, 'payload'), 'fixture');
    await owned.cleanup();
    await assert.rejects(readFile(join(owned.path, 'payload')), { code: 'ENOENT' });
    const altered = await createOwnedDirectory(parent, 'owned-');
    await writeFile(join(altered.path, '.connector-install-owner'), 'someone-else');
    await assert.rejects(altered.cleanup());
    assert.equal(await readFile(join(altered.path, '.connector-install-owner'), 'utf8'), 'someone-else');
  } finally { assertInside(parent, tmpdir()); await rm(parent, { recursive: true, force: true }); }
});

test('installed core must contain the exact source modules and bytes', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'connector-core-unit-'));
  try {
    const source = join(parent, 'source'), resources = join(parent, 'resources');
    await mkdir(source); await mkdir(join(resources, 'core'), { recursive: true });
    for (const directory of [source, join(resources, 'core')]) await writeFile(join(directory, 'runtime.mjs'), 'export const test = 1;');
    const result = await verifyInstalledCore(resources, source);
    assert.equal(result.count, 1);
    await writeFile(join(resources, 'core', 'runtime.mjs'), 'old binary');
    await assert.rejects(verifyInstalledCore(resources, source));
    await writeFile(join(resources, 'core', 'runtime.mjs'), 'export const test = 1;');
    await writeFile(join(resources, 'core', 'obsolete.mjs'), 'unexpected');
    await assert.rejects(verifyInstalledCore(resources, source));
  } finally { assertInside(parent, tmpdir()); await rm(parent, { recursive: true, force: true }); }
});

test('an installed core directory cannot alias the source tree through a symlink', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'connector-core-alias-unit-'));
  try {
    const source = join(parent, 'source'), resources = join(parent, 'resources');
    await mkdir(source); await mkdir(resources);
    await writeFile(join(source, 'runtime.mjs'), 'export const fixture = 1;');
    await symlink(source, join(resources, 'core'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(verifyInstalledCore(resources, source));
  } finally { assertInside(parent, tmpdir()); await rm(parent, { recursive: true, force: true }); }
});

test('diagnostics retain failure type and phase without copying URI, stderr or a path', () => {
  const value = diagnostic(Object.assign(new Error('secret hapark-connect://connect?launchToken=private'), { code: 'ENOENT', stderr: 'private content' }), 'installed_launch');
  assert.deepEqual(value, { phase: 'installed_launch', code: 'ENOENT' });
  assert.equal(JSON.stringify(value).includes('private'), false);
  assert.deepEqual(diagnostic({ code: 'raw secret code' }, 'raw private phase'), { phase: 'unknown', code: 'UNKNOWN' });
});

test('native assertion diagnostics expose only the verifier filename and numeric source position', () => {
  const error = { code: 'ERR_ASSERTION', stack: 'Error: private-token\n at verify (file:///private/secret/ci-installed-macos.mjs:188:12)' };
  assert.deepEqual(diagnostic(error, 'macos_bundle'), { phase: 'macos_bundle', code: 'ERR_ASSERTION', site: { file: 'ci-installed-macos.mjs', line: 188, column: 12 } });
  assert.equal(JSON.stringify(diagnostic(error, 'macos_bundle')).includes('private'), false);
  assert.deepEqual(diagnostic({ code: 'ERR_ASSERTION', stack: 'Error: private\n at credential (/private/secrets/user.mjs:17:22)' }, 'macos_bundle'), { phase: 'macos_bundle', code: 'ERR_ASSERTION' });
});
