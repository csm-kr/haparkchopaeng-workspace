import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseLaunchUrl } from '../core/security.mjs';
import { invokeWindowsNative } from '../scripts/ci-installed-windows.mjs';
import {
  assertWindowsRunner, windowsSmokeLayout, assertOwnedWindowsInstallation, parseWindowsSmokeArguments,
  assertWindowsProcessIdentity, sameWindowsProcess, selectWindowsMain, assertWindowsRejectedState,
  assertFreshWindowsProfile, assertWindowsProtocolCommand, windowsSmokeUris,
  classifyWindowsKnownProcess,
  windowsProcessObservation,
  windowsProfileObservation,
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
