import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLaunchUrl } from '../core/security.mjs';
import { invokeWindowsNative } from '../scripts/ci-installed-windows.mjs';
import { run } from '../scripts/installed-smoke-support.mjs';
import {
  assertWindowsRunner, windowsSmokeLayout, assertOwnedWindowsInstallation, parseWindowsSmokeArguments,
  assertWindowsProcessIdentity, sameWindowsProcess, selectWindowsMain, assertWindowsRejectedState,
  assertFreshWindowsProfile, assertWindowsProtocolCommand, windowsSmokeUris,
  classifyWindowsKnownProcess,
  windowsProcessObservation,
  windowsProfileObservation,
  windowsControlledUriObservation,
  assertWindowsTokenContext,
  captureWindowsColdUriSnapshot,
  WINDOWS_COLD_ERROR, WINDOWS_WARM_ERROR,
} from '../scripts/installed-windows-support.mjs';

const env = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows', LOCAL_AGENT_INSTALL_QA: '1', GITHUB_WORKSPACE: 'D:\\a\\project\\project', RUNNER_TEMP: 'D:\\a\\_temp' };
const workspace = env.GITHUB_WORKSPACE;
const installation = `${env.RUNNER_TEMP}\\research-notebook-connector-install-${'a'.repeat(32)}`;
const configuration = { appId: 'org.example.research-notebook', productName: 'Research Connector', scheme: 'research-connect', profileRelativePath: ['org.example.research-notebook', 'production'] };
const layout = () => windowsSmokeLayout(configuration, { applicationId: 'research-notebook', executableName: 'research-notebook-connector' });
const sid = 'S-1-5-21-111-222-333-1001';
const startedAt = Date.parse('2026-10-17T12:00:00.000Z');
const executable = `${installation}\\research-notebook-connector.exe`;
const processRow = (overrides = {}) => ({ pid: 1234, executable, sid, createdAt: '2026-10-17T12:00:01.000Z', argv: [executable], ...overrides });

test('Windows token context requires the current user and a complete canonical default-owner SID', () => {
  assert.doesNotThrow(() => assertWindowsTokenContext({ sid, tokenOwnerSid: 'S-1-5-32-544' }));
  assert.doesNotThrow(() => assertWindowsTokenContext({ sid, tokenOwnerSid: sid }));
  for (const tokenOwnerSid of [undefined, null, '', '*', 'S-1-5', 'S-1-5-32-544-extra', 'S-1-5-32-544\n', 'S-1-5-32-4294967296', 'S-1-281474976710656-1', `S-1-5${'-1'.repeat(16)}`]) {
    assert.throws(() => assertWindowsTokenContext({ sid, tokenOwnerSid }));
  }
  assert.throws(() => assertWindowsTokenContext({ sid: 'S-1-5-18', tokenOwnerSid: 'S-1-5-32-544' }));
});

function syntheticWindowsPathExecutor(aclSetup) {
  return async (file, args, options) => {
    const original = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    const script = `${aclSetup}\nfunction Test-Path { $true }\nfunction Get-Item { [pscustomobject]@{ Attributes = [IO.FileAttributes]::Directory } }\n${original}`;
    const result = spawnSync(file, [...args.slice(0, -1), Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', windowsHide: true, shell: false, timeout: options.timeout });
    const captured = { code: Number.isInteger(result.status) ? result.status : 127, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    if (captured.code !== 0) throw Object.assign(new Error('Synthetic path observation failed'), { code: 'COMMAND_FAILED', result: captured });
    return captured;
  };
}

async function removeModuleFixture(fixture, temporaryRoot) {
  const resolved = await realpath(fixture), relative = path.relative(temporaryRoot, resolved);
  assert.ok(path.isAbsolute(resolved) && relative && !relative.includes(path.sep) && relative.startsWith('connector-winps-modulepath-')
    && path.dirname(resolved).toLowerCase() === temporaryRoot.toLowerCase() && !(await lstat(fixture)).isSymbolicLink(), 'Unsafe module fixture cleanup target');
  await rm(resolved, { recursive: true });
}

test('native child removes every inherited PSModulePath casing without changing its parent environment', async () => {
  const environment = { PSMODULEPATH: 'CORE_ONLY', PSModulePath: 'CORE_ONLY', psmodulepath: 'CORE_ONLY', PATH: 'PRESERVED_PATH', PRIVATE_VALUE: 'PRESERVED_VALUE' };
  const before = JSON.stringify(environment);
  let options;
  await invokeWindowsNative('context', {}, { environment, execute: async (_file, _args, value) => { options = value; return { code: 0, stdout: '{}', stderr: '' }; } });
  assert.ok(options.env && typeof options.env === 'object', 'The child module environment must be explicit');
  assert.deepEqual(Object.keys(options.env).sort(), ['PSMODULEPATH', 'PSModulePath', 'psmodulepath'].sort());
  assert.ok(Object.values(options.env).every(value => value === undefined));
  assert.ok(JSON.stringify(environment) === before, 'The parent environment must stay intact');
});

test('native child rebuilds WinPS module defaults instead of loading an inherited incompatible Security module', { skip: process.platform !== 'win32' }, async () => {
  const temporaryRoot = await realpath(tmpdir()), fixture = await mkdtemp(path.join(temporaryRoot, 'connector-winps-modulepath-'));
  try {
    const modules = path.join(fixture, 'modules'), moduleDirectory = path.join(modules, 'Microsoft.PowerShell.Security');
    await mkdir(moduleDirectory, { recursive: true });
    await writeFile(path.join(moduleDirectory, 'Microsoft.PowerShell.Security.psd1'), "@{ RootModule='Microsoft.PowerShell.Security.psm1'; ModuleVersion='7.0.0.0'; GUID='f96700c9-0f07-459c-8067-96f23839fc07'; CmdletsToExport=@('Get-Acl'); FunctionsToExport=@(); AliasesToExport=@() }");
    await writeFile(path.join(moduleDirectory, 'Microsoft.PowerShell.Security.psm1'), "throw (New-Object InvalidOperationException('SYNTHETIC_MODULE_IMPORT_FAILURE'))");
    const modulePath = modules + path.delimiter + (process.env.PSMODULEPATH ?? process.env.PSModulePath ?? '');
    const environment = { ...process.env, PSMODULEPATH: modulePath, PSModulePath: modulePath, psmodulepath: modulePath };
    const before = JSON.stringify(environment);
    const result = await invokeWindowsNative('path', { path: fixture }, { environment,
      execute: (file, args, options) => run(file, args, { ...options, env: { ...environment, ...options.env } }) });
    assert.equal(result.exists, true); assert.equal(result.reparsePoint, false);
    assert.ok(typeof result.sid === 'string' && /^S-\d+(?:-\d+)+$/.test(result.sid), 'An ACL SID must be observed without account-name lookup');
    assert.ok(JSON.stringify(environment) === before, 'The poisoned parent environment must stay intact');
  } finally { await removeModuleFixture(fixture, temporaryRoot); }
});

test('path ownership reads the descriptor SID even when its account name cannot be resolved', { skip: process.platform !== 'win32' }, async () => {
  const execute = syntheticWindowsPathExecutor(String.raw`
$qaSyntheticDescriptor = New-Object Security.AccessControl.DirectorySecurity
$qaSyntheticDescriptor.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-21-111-222-333-99999')))
$qaSyntheticDescriptor | Add-Member -MemberType ScriptProperty -Name Owner -Value { $this.GetOwner([Security.Principal.NTAccount]).Value }
function Get-Acl { $qaSyntheticDescriptor }
`);
  const result = await invokeWindowsNative('path', { path: 'SYNTHETIC_NO_FILESYSTEM_ACCESS' }, { execute });
  assert.deepEqual(result, { exists: true, sid: 'S-1-5-21-111-222-333-99999', reparsePoint: false });
});

test('an unreadable ACL fails closed with a fixed path stage and exception type', { skip: process.platform !== 'win32' }, async () => {
  const privateText = 'PRIVATE_ACCOUNT_PATH_AND_TOKEN';
  const execute = syntheticWindowsPathExecutor(`function Get-Acl { throw (New-Object UnauthorizedAccessException('${privateText}')) }`);
  await assert.rejects(invokeWindowsNative('path', { path: 'SYNTHETIC_NO_FILESYSTEM_ACCESS' }, { execute }), error => {
    assert.equal(error.code, 'WINDOWS_NATIVE_FAILED');
    assert.equal(error.nativeFailure.operation, 'path');
    assert.equal(error.nativeFailure.exitCode, 1);
    assert.equal(error.nativeFailure.pathStage, 'acl');
    assert.equal(error.nativeFailure.exceptionType, 'UnauthorizedAccessException');
    assert.equal(JSON.stringify(error).includes(privateText), false);
    return true;
  });
});

test('native failures retain only an allowlisted operation, exit code and fixed stderr category', async () => {
  const privateText = 'PRIVATE_ACCOUNT_PATH_AND_TOKEN';
  const execute = async () => { throw Object.assign(new Error(privateText), { code: 'COMMAND_FAILED',
    result: { code: 1, stdout: privateText, stderr: `Add-Type : CompilerErrors CS0001 ${privateText}` } }); };
  await assert.rejects(invokeWindowsNative('context', {}, { execute }), error => {
    assert.equal(error.code, 'WINDOWS_NATIVE_FAILED');
    assert.deepEqual(error.nativeFailure, { operation: 'context', exitCode: 1, stderrCategory: 'POWERSHELL_COMPILE' });
    assert.equal(JSON.stringify(error).includes(privateText), false);
    assert.equal(error.message.includes(privateText), false);
    return true;
  });
});

test('invalid native JSON is diagnosed without exposing captured output', async () => {
  const privateText = 'PRIVATE_ACCOUNT_PATH_AND_TOKEN';
  await assert.rejects(invokeWindowsNative('context', {}, { execute: async () => ({ code: 0, stdout: privateText, stderr: '' }) }), error => {
    assert.equal(error.code, 'WINDOWS_NATIVE_INVALID_JSON');
    assert.deepEqual(error.nativeFailure, { operation: 'context', exitCode: 0, stderrCategory: 'NATIVE_INVALID_JSON' });
    assert.equal(JSON.stringify(error).includes(privateText), false);
    assert.equal(error.message.includes(privateText), false);
    return true;
  });
});

test('cold process diagnostics distinguish path matches, current-user mains and exact URI delivery without argv', () => {
  const uri = windowsSmokeUris(layout()).cold;
  const observation = { counts: { installedPathRows: 3, otherUserRows: 1 }, processes: [
    processRow({ argv: [executable, uri] }),
    processRow({ pid: 1235, argv: [executable, '--type=renderer'] }),
  ] };
  const summary = windowsProcessObservation(observation, { executable, uri });
  assert.deepEqual(summary, { nativeCountsObserved: true, installedPathRows: 3, otherUserRows: 1, currentUserRows: 2, mainRows: 1, exactUriRows: 1 });
  const otherUserOnly = windowsProcessObservation({ counts: { installedPathRows: 1, otherUserRows: 1 }, processes: [] }, { executable, uri });
  assert.equal(otherUserOnly.installedPathRows, 1);
  assert.equal(otherUserOnly.currentUserRows, 0);
  assert.equal(otherUserOnly.mainRows, 0);
  assert.equal(otherUserOnly.exactUriRows, 0);
  const json = JSON.stringify(summary);
  for (const privateValue of [sid, executable, uri, 'argv', 'pid']) assert.equal(json.includes(privateValue), false);
});

test('controlled URI diagnostics distinguish OS canonicalization without disclosing another argument', () => {
  const uri = windowsSmokeUris(layout()).cold;
  const normalized = uri.replace('://connect?', '://connect/?');
  const privateText = 'PRIVATE_ACCOUNT_PATH_AND_TOKEN';
  const rows = [processRow({ argv: [executable, normalized, privateText] })];
  const summary = windowsControlledUriObservation(rows, { executable, uri });
  assert.equal(summary.mainArgCount, 3);
  assert.equal(summary.schemeArgCount, 1); assert.equal(summary.controlledTokenArgCount, 1);
  assert.equal(summary.rawExactMatch, false); assert.equal(summary.urlCanonicalMatch, false);
  assert.equal(summary.exactControlledUriWithSlash, true); assert.equal(summary.pathnameEmptyOrSlash, true);
  assert.equal(summary.queryKeysMatch, true); assert.equal(summary.attemptValueMatch, true);
  const schemeCase = windowsControlledUriObservation([processRow({ argv: [executable, uri.replace('research-connect:', 'RESEARCH-CONNECT:')] })], { executable, uri });
  assert.equal(schemeCase.rawExactMatch, false); assert.equal(schemeCase.caseFoldMatch, true); assert.equal(schemeCase.urlCanonicalMatch, true);
  assert.equal(selectWindowsMain(rows, { installation, executable, sid, notBefore: startedAt, uri }).pid, 1234);
  for (const privateValue of [privateText, sid, executable, uri, normalized, 'argv']) assert.equal(JSON.stringify(summary).includes(privateValue), false);
  assert.throws(() => windowsControlledUriObservation(rows, { executable, uri: 'research-connect://connect?launchToken=private' }));
});

test('controlled URI diagnostics recognize a percent-encoded synthetic token without admitting it', () => {
  const uri = windowsSmokeUris(layout()).cold;
  const rows = [processRow({ argv: [executable, uri.replace('ci-package-cold', 'ci-package%2Dcold')] })];
  const summary = windowsControlledUriObservation(rows, { executable, uri });
  assert.equal(summary.controlledTokenArgCount, 1);
  assert.equal(summary.rawExactMatch, false); assert.equal(summary.percentDecodedMatch, true);
  assert.equal(summary.queryKeysMatch, true); assert.equal(summary.attemptValueMatch, true);
  assert.equal(selectWindowsMain(rows, { installation, executable, sid, notBefore: startedAt, uri }), null);
});

test('accepted cold URI proof stays unchanged when a later warm argv sample differs', () => {
  const uri = windowsSmokeUris(layout()).cold, options = { executable, uri };
  const coldRows = [processRow({ argv: [executable, uri.replace('://connect?', '://connect/?')] })];
  const snapshot = captureWindowsColdUriSnapshot(coldRows, options);
  assert.equal(snapshot.exactUriArgumentObserved, false);
  assert.equal(snapshot.controlledUriArgumentObserved, true); assert.equal(snapshot.normalizedRootSlashObserved, true);
  const later = windowsControlledUriObservation([processRow({ argv: [executable, '--remote-debugging-port=1234', uri] })], options);
  coldRows[0].argv[1] = uri;
  assert.equal(later.rawExactMatch, true); assert.equal(later.exactControlledUriWithSlash, false);
  assert.equal(snapshot.uriArgumentObservation.rawExactMatch, false);
  assert.equal(snapshot.uriArgumentObservation.exactControlledUriWithSlash, true);
  assert.equal(snapshot.uriArgumentObservation.mainArgCount, 2);
  assert.throws(() => captureWindowsColdUriSnapshot([processRow()], options));
});

test('Windows URI execution requires the explicitly allowed disposable hosted runner before OS work', () => {
  assert.equal(assertWindowsRunner(env, { platform: 'win32', workspace }).runnerTemp, env.RUNNER_TEMP);
  for (const override of [{ CI: '' }, { GITHUB_ACTIONS: '' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { RUNNER_OS: 'Linux' }, { LOCAL_AGENT_INSTALL_QA: '' }, { GITHUB_WORKSPACE: 'D:\\other' }, { RUNNER_TEMP: workspace }, { RUNNER_TEMP: `${workspace}\\temp` }, { RUNNER_TEMP: 'D:\\' }, { RUNNER_TEMP: 'relative' }]) {
    assert.throws(() => assertWindowsRunner({ ...env, ...override }, { platform: 'win32', workspace }));
  }
  assert.throws(() => assertWindowsRunner(env, { platform: 'linux', workspace }));
});

test('Windows smoke accepts only an explicit owned installation argument', () => {
  assert.deepEqual(parseWindowsSmokeArguments(['--installation', installation, '--preflight']), { installation, preflight: true });
  assert.deepEqual(parseWindowsSmokeArguments(['--installation', installation]), { installation, preflight: false });
  for (const argv of [[], ['--installation'], ['--installation', installation, '--installation', installation], ['--installation', installation, '--connector-dev'], ['--preflight'], ['--installation', installation, '--preflight', '--preflight']]) assert.throws(() => parseWindowsSmokeArguments(argv));
});

test('two host layouts keep native executable, protocol and production profile identities separate', () => {
  const first = layout();
  assert.equal(first.executableFilename, 'research-notebook-connector.exe');
  assert.deepEqual(first.profileRelativePath, ['org.example.research-notebook', 'production']);
  assert.equal(first.installationPrefix, 'research-notebook-connector-install-');
  const second = windowsSmokeLayout({ appId: 'kr.hapark.connector', productName: 'Hapark Connector', scheme: 'hapark-connect', profileRelativePath: [] }, { applicationId: 'hapark' });
  assert.equal(second.executableFilename, 'Hapark Connector.exe');
  assert.deepEqual(second.profileRelativePath, ['Hapark Connector']);
  assert.notEqual(first.scheme, second.scheme);
  for (const candidate of [{ ...configuration, profileRelativePath: ['..', 'production'] }, { ...configuration, profileRelativePath: ['org.other', 'production'] }, { ...configuration, profileRelativePath: ['org.example.research-notebook', 'development'] }]) assert.throws(() => windowsSmokeLayout(candidate, { applicationId: 'research-notebook' }));
  for (const executableName of ['..\\other', 'other/exe', 'name.exe', '', 'C:\\Windows\\other']) assert.throws(() => windowsSmokeLayout(configuration, { applicationId: 'research-notebook', executableName }));
});

test('installation ownership requires the exact host prefix and a direct GUID child of runner temp', () => {
  assert.equal(assertOwnedWindowsInstallation(installation, env.RUNNER_TEMP, layout().installationPrefix), installation);
  for (const candidate of [env.RUNNER_TEMP, `${env.RUNNER_TEMP}-other\\research-notebook-connector-install-${'a'.repeat(32)}`, `${env.RUNNER_TEMP}\\other\\research-notebook-connector-install-${'a'.repeat(32)}`, `${env.RUNNER_TEMP}\\hapark-connector-install-${'a'.repeat(32)}`, `${env.RUNNER_TEMP}\\research-notebook-connector-install-not-a-guid`, 'relative']) assert.throws(() => assertOwnedWindowsInstallation(candidate, env.RUNNER_TEMP, layout().installationPrefix));
});

test('process ownership requires exact installed path, SID and start time, including PID reuse checks', () => {
  const identity = assertWindowsProcessIdentity(processRow(), { installation, executable, sid, notBefore: startedAt });
  assert.equal(identity.pid, 1234);
  assert.equal(sameWindowsProcess(processRow(), identity), true);
  for (const override of [{ pid: 0 }, { executable: 'C:\\other\\research-notebook-connector.exe' }, { sid: 'S-1-5-18' }, { createdAt: '2026-10-17T11:59:50.000Z' }, { createdAt: 'invalid' }]) assert.throws(() => assertWindowsProcessIdentity(processRow(override), { installation, executable, sid, notBefore: startedAt }));
  assert.equal(sameWindowsProcess(processRow({ createdAt: '2026-10-17T12:01:00.000Z' }), identity), false);
  assert.equal(sameWindowsProcess(processRow({ executable: 'C:\\other\\research-notebook-connector.exe' }), identity), false);
  assert.equal(sameWindowsProcess(processRow({ sid: 'S-1-5-18' }), identity), false);
});

test('a known PID with unavailable identity is unknown, never proof of process exit', () => {
  const identity = assertWindowsProcessIdentity(processRow(), { installation, executable, sid, notBefore: startedAt });
  assert.equal(classifyWindowsKnownProcess({ exists: false }, identity), 'gone');
  assert.equal(classifyWindowsKnownProcess({ ...processRow(), exists: true }, identity), 'running');
  assert.equal(classifyWindowsKnownProcess({ exists: true, createdAt: '2026-10-17T12:00:02.000Z' }, identity), 'gone');
  for (const observation of [null, {}, { exists: true }, { exists: true, createdAt: 'unknown' }, { exists: true, createdAt: '2026' }, { ...processRow(), exists: true, executable: null }, { ...processRow(), exists: true, sid: null }, { ...processRow(), exists: true, executable: 'C:\\other.exe' }]) {
    assert.throws(() => classifyWindowsKnownProcess(observation, identity), error => error.code === 'PROCESS_OBSERVATION_UNAVAILABLE');
  }
});

test('cold selection observes one installed main and the exact OS-delivered URI argument', () => {
  const uri = windowsSmokeUris(layout()).cold;
  const args = { installation, executable, sid, notBefore: startedAt, uri };
  assert.equal(selectWindowsMain([processRow({ argv: [executable, uri] }), processRow({ pid: 1235, argv: [executable, '--type=renderer'] })], args).pid, 1234);
  assert.equal(selectWindowsMain([processRow()], args), null);
  assert.equal(selectWindowsMain([processRow({ argv: [executable, `${uri}-other`] })], args), null);
  assert.throws(() => selectWindowsMain([processRow({ argv: [executable, uri] }), processRow({ pid: 1236, argv: [executable, uri] })], args));
});

test('cold selection accepts only the exact controlled input or its observed OS root-slash form', () => {
  const uri = windowsSmokeUris(layout()).cold, slash = uri.replace('://connect?', '://connect/?');
  const options = { installation, executable, sid, notBefore: startedAt, uri };
  assert.equal(selectWindowsMain([processRow({ argv: [executable, slash] })], options).pid, 1234);
  for (const candidate of [
    uri.replace('://connect?', '://connect/other?'), uri.replace('://connect?', '://connect//?'),
    `${slash}&extra=1`, `${slash}&attemptId=ci-package-cold`, `${slash}#fragment`,
    slash.replace('ci-package-cold', 'other'), slash.replace('attemptId', 'attemptid'),
    slash.replace('ci-package-cold', 'ci-package%2Dcold'), slash.replace('research-connect', 'other-connect'),
  ]) assert.equal(selectWindowsMain([processRow({ argv: [executable, candidate] })], options), null);
});

test('both synthetic URI cases are rejected by the shipping parser before identity/API work', () => {
  const { cold, warm } = windowsSmokeUris(layout());
  const applications = [{ id: 'research-notebook', scheme: layout().scheme, origin: 'https://research.example', allowedOrigins: ['https://research.example'] }];
  assert.throws(() => parseLaunchUrl(cold, applications), error => error.message === WINDOWS_COLD_ERROR);
  assert.throws(() => parseLaunchUrl(warm, applications), error => error.message === WINDOWS_WARM_ERROR);
  const state = { stage: 'error', description: WINDOWS_WARM_ERROR, attemptId: null, providers: [], autoStart: false, pet: false };
  assert.doesNotThrow(() => assertWindowsRejectedState(state, WINDOWS_WARM_ERROR));
  for (const override of [{ stage: 'connected' }, { attemptId: 'unexpected' }, { providers: [{ provider: 'codex' }] }, { autoStart: true }, { pet: true }]) assert.throws(() => assertWindowsRejectedState({ ...state, ...override }, WINDOWS_WARM_ERROR));
});

test('profile cleanup refuses prior, foreign, redirected and stale directories', () => {
  const appData = 'C:\\Users\\runner\\AppData\\Roaming';
  const profile = `${appData}\\org.example.research-notebook\\production`;
  const fresh = { path: profile, exists: true, directory: true, reparsePoint: false, realPath: profile, sid, createdAt: '2026-10-17T12:00:01.000Z' };
  const ownership = { appData, profile, sid, notBefore: startedAt, existedBefore: false };
  assert.doesNotThrow(() => assertFreshWindowsProfile(fresh, ownership));
  assert.throws(() => assertFreshWindowsProfile(fresh, { ...ownership, existedBefore: true }));
  for (const override of [{ path: appData }, { path: `${profile}-other` }, { realPath: 'C:\\other' }, { directory: false }, { reparsePoint: true }, { sid: 'S-1-5-18' }, { createdAt: '2026-10-16T12:00:00.000Z' }]) assert.throws(() => assertFreshWindowsProfile({ ...fresh, ...override }, ownership));
});

test('profile cleanup admits only the current user or the same validated token default owner', () => {
  const appData = 'C:\\Users\\runner\\AppData\\Roaming', profile = `${appData}\\org.example.research-notebook\\production`;
  const tokenOwnerSid = 'S-1-5-32-544';
  const ownership = { appData, profile, sid, tokenOwnerSid, notBefore: startedAt, existedBefore: false };
  const fresh = { path: profile, exists: true, directory: true, reparsePoint: false, realPath: profile, sid: tokenOwnerSid, createdAt: '2026-10-17T12:00:01.000Z' };
  assert.doesNotThrow(() => assertFreshWindowsProfile(fresh, ownership));
  assert.doesNotThrow(() => assertFreshWindowsProfile({ ...fresh, sid }, ownership));
  assert.throws(() => assertFreshWindowsProfile(fresh, { ...ownership, tokenOwnerSid: 'S-1-5-32-545' }));
  assert.throws(() => assertFreshWindowsProfile({ ...fresh, sid: 'S-1-5-32-545' }, ownership));
  for (const invalid of ['', '*', 'S-1-5-32-4294967296']) assert.throws(() => assertFreshWindowsProfile(fresh, { ...ownership, tokenOwnerSid: invalid }));
  assert.throws(() => assertFreshWindowsProfile(fresh, { ...ownership, existedBefore: true }));
  for (const override of [{ path: appData }, { realPath: 'C:\\other' }, { directory: false }, { reparsePoint: true }, { createdAt: '2026-10-16T12:00:00.000Z' }]) {
    assert.throws(() => assertFreshWindowsProfile({ ...fresh, ...override }, ownership));
  }
  assert.throws(() => assertWindowsProcessIdentity(processRow({ sid: tokenOwnerSid }), { installation, executable, sid, tokenOwnerSid, notBefore: startedAt }));
  const observation = windowsProfileObservation(fresh, ownership);
  assert.equal(observation.currentUserOwner, false); assert.equal(observation.currentTokenOwner, true);
  for (const privateValue of [sid, tokenOwnerSid, profile]) assert.equal(JSON.stringify(observation).includes(privateValue), false);
});

test('profile diagnostics distinguish current-user and Administrators ownership without weakening cleanup', () => {
  const appData = 'C:\\Users\\runner\\AppData\\Roaming';
  const profile = `${appData}\\org.example.research-notebook\\production`;
  const ownership = { appData, profile, sid, notBefore: startedAt, existedBefore: false };
  const descriptor = { path: profile, exists: true, directory: true, reparsePoint: false, realPath: profile,
    sid: 'S-1-5-32-544', createdAt: '2026-10-17T12:00:01.000Z' };
  const summary = windowsProfileObservation(descriptor, ownership);
  assert.deepEqual(summary, { exists: true, directory: true, reparsePoint: false, exactPathMatches: true,
    realPathMatches: true, currentUserOwner: false, administratorsOwner: true, createdAfterStart: true });
  assert.throws(() => assertFreshWindowsProfile(descriptor, ownership));
  const current = windowsProfileObservation({ ...descriptor, sid }, ownership);
  assert.equal(current.currentUserOwner, true); assert.equal(current.administratorsOwner, false);
  for (const privateValue of [sid, descriptor.sid, profile, 'createdAt']) assert.equal(JSON.stringify(summary).includes(privateValue), false);
});

test('protocol command must contain only the quoted installed executable and URI placeholder', () => {
  assert.doesNotThrow(() => assertWindowsProtocolCommand(`"${executable}" "%1"`, executable));
  for (const command of [`"${executable}" --connector-qa "%1"`, `"${executable}"`, `cmd.exe /c "${executable}" "%1"`, `"C:\\other.exe" "%1"`]) assert.throws(() => assertWindowsProtocolCommand(command, executable));
});

test('installer cold proof accepts the controlled OS root slash while retaining exact-URI truth', { skip: process.platform !== 'win32' }, () => {
  const file = fileURLToPath(new URL('../scripts/verify-windows-installer.ps1', import.meta.url));
  const cases = [
    { receipt: null, allowed: false }, { receipt: {}, allowed: false },
    { receipt: { cold: { exactUriArgumentObserved: true, normalWindowCloseObserved: true } }, allowed: false },
    { receipt: { cold: { exactUriArgumentObserved: false, controlledUriArgumentObserved: true, normalizedRootSlashObserved: true, normalWindowCloseObserved: true } }, allowed: true },
    { receipt: { cold: { exactUriArgumentObserved: true, controlledUriArgumentObserved: true, normalizedRootSlashObserved: false, normalWindowCloseObserved: true } }, allowed: true },
    { receipt: { cold: { controlledUriArgumentObserved: 'true', normalWindowCloseObserved: true } }, allowed: false },
    { receipt: { cold: { controlledUriArgumentObserved: true, normalWindowCloseObserved: false } }, allowed: false },
    { receipt: { cold: { controlledUriArgumentObserved: true, normalWindowCloseObserved: 'true' } }, allowed: false },
  ];
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$qaFile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(file).toString('base64')}'))
$qaTokens = $null; $qaErrors = $null
$qaAst = [Management.Automation.Language.Parser]::ParseFile($qaFile, [ref]$qaTokens, [ref]$qaErrors)
$qaFunction = $qaAst.Find({ param($qaNode) $qaNode -is [Management.Automation.Language.FunctionDefinitionAst] -and $qaNode.Name -eq 'Test-QaControlledColdUriVerified' }, $true)
if (-not $qaFunction) { throw 'Pure controlled URI policy function missing' }
. ([ScriptBlock]::Create($qaFunction.Extent.Text))
$qaCases = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(cases)).toString('base64')}')) | ConvertFrom-Json
foreach ($qaCase in $qaCases) {
  $qaAllowed = Test-QaControlledColdUriVerified -SmokeReceipt $qaCase.receipt
  if ($qaAllowed -isnot [bool] -or $qaAllowed -ne $qaCase.allowed) { throw 'Controlled URI receipt policy failed' }
}
'PURE_CONTROLLED_URI_POLICY_OK'
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, shell: false, timeout: 15_000 });
  assert.equal(result.status, 0, 'The extracted pure controlled URI receipt policy failed');
  assert.match(result.stdout, /PURE_CONTROLLED_URI_POLICY_OK/);
});

test('installer cleanup requires a completed full-smoke process-stop receipt even when JSON is missing', { skip: process.platform !== 'win32' }, () => {
  const file = fileURLToPath(new URL('../scripts/verify-windows-installer.ps1', import.meta.url));
  const cases = [
    { enabled: false, receipt: null, allowed: true },
    { enabled: true, receipt: null, allowed: false },
    { enabled: true, receipt: {}, allowed: false },
    { enabled: true, receipt: { preflightOnly: true, cleanup: { ownedProcessesStopped: true } }, allowed: false },
    { enabled: true, receipt: { preflightOnly: false, cleanup: { ownedProcessesStopped: false } }, allowed: false },
    { enabled: true, receipt: { preflightOnly: false, cleanup: { ownedProcessesStopped: 'true' } }, allowed: false },
    { enabled: true, receipt: { preflightOnly: false, cleanup: { ownedProcessesStopped: true, deferred: true } }, allowed: false },
    { enabled: true, receipt: { passed: false, preflightOnly: false, cleanup: { ownedProcessesStopped: true } }, allowed: true },
    { enabled: true, receipt: { passed: true, preflightOnly: false, cleanup: { ownedProcessesStopped: true, deferred: false } }, allowed: true },
  ];
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$qaFile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(file).toString('base64')}'))
$qaTokens = $null; $qaErrors = $null
$qaAst = [Management.Automation.Language.Parser]::ParseFile($qaFile, [ref]$qaTokens, [ref]$qaErrors)
$qaFunction = $qaAst.Find({ param($qaNode) $qaNode -is [Management.Automation.Language.FunctionDefinitionAst] -and $qaNode.Name -eq 'Test-QaOwnedCleanupAllowed' }, $true)
if (-not $qaFunction) { throw 'Pure cleanup policy function missing' }
# Evaluate only this pure function definition, never the installer script.
. ([ScriptBlock]::Create($qaFunction.Extent.Text))
$qaCases = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(cases)).toString('base64')}')) | ConvertFrom-Json
foreach ($qaCase in $qaCases) {
  $qaAllowed = Test-QaOwnedCleanupAllowed -CiUriEnabled $qaCase.enabled -SmokeReceipt $qaCase.receipt
  if ($qaAllowed -isnot [bool] -or $qaAllowed -ne $qaCase.allowed) { throw 'Unsafe cleanup policy result' }
}
'Pure cleanup policy cases passed; no installer, URI or filesystem removal executed.'
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 15_000 });
  assert.equal(result.status, 0, 'The extracted pure installer cleanup policy failed');
  assert.match(result.stdout, /Pure cleanup policy cases passed/);
});
