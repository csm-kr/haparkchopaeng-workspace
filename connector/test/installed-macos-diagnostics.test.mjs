import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyMacSignatureVerification, selectOwnedMacCrashDiagnostic } from '../scripts/installed-macos-diagnostics.mjs';
import * as diagnostics from '../scripts/installed-macos-diagnostics.mjs';

const ownership = { pid: 9818, appId: 'kr.fixture.connector', executable: '/Applications/connector-ci-owned/연결기.app/Contents/MacOS/연결기' };
const report = {
  pid: ownership.pid, procPath: ownership.executable,
  bundleInfo: { CFBundleIdentifier: ownership.appId },
  exception: { type: 'EXC_CRASH', signal: 'SIGKILL' },
  termination: { namespace: 'CODESIGNING', code: 2, indicator: 'private raw detail' },
  privateData: 'private-token /Users/private/user@example.test',
};
const ips = value => `${JSON.stringify({ app_name: 'private name', bundleID: ownership.appId })}\n${JSON.stringify(value, null, 2)}`;

test('macOS signature verification emits only fixed classifications and the exit code', () => {
  assert.deepEqual(classifyMacSignatureVerification({ code: 0, stderr: 'private path: valid on disk' }),
    { exitCode: 0, valid: true, reason: 'valid' });
  for (const [stderr, reason] of [
    ['private-token: invalid signature (code or signature have been modified)', 'signature_invalid'],
    ['private-token: a sealed resource is missing or invalid', 'resource_modified'],
    ['private-token: code object is not signed at all', 'unsigned'],
    ['private-token: Operation not permitted', 'permission'],
    ['private-token: unrecognized failure', 'unknown'],
  ]) {
    const selected = classifyMacSignatureVerification({ code: 1, stderr });
    assert.deepEqual(selected, { exitCode: 1, valid: false, reason });
    assert.equal(JSON.stringify(selected).includes('private'), false);
  }
});

test('a two-object ips report must match the launched PID, exact executable and app ID', () => {
  assert.deepEqual(selectOwnedMacCrashDiagnostic(ips(report), ownership), {
    format: 'ips', reason: 'code_signature', exception: 'EXC_CRASH', signal: 'SIGKILL',
    terminationNamespace: 'CODESIGNING', terminationCode: 2,
  });
  for (const changed of [
    { ...report, pid: ownership.pid + 1 },
    { ...report, procPath: '/Applications/another.app/Contents/MacOS/another' },
    { ...report, bundleInfo: { CFBundleIdentifier: 'other.app' } },
    { ...report, bundleInfo: {} },
  ]) assert.equal(selectOwnedMacCrashDiagnostic(ips(changed), ownership), null);
});

test('crash matching accepts macOS Unicode equivalence without allowing another file', () => {
  assert.equal(selectOwnedMacCrashDiagnostic(ips({ ...report, procPath: ownership.executable.normalize('NFD') }), ownership)?.reason, 'code_signature');
  assert.equal(selectOwnedMacCrashDiagnostic(ips({ ...report, procPath: ownership.executable + '/other' }), ownership), null);
});

test('legacy owned crash reports expose fixed reason enums without raw text', () => {
  const text = `Process: private name [9818]\nPath: ${ownership.executable}\nIdentifier: ${ownership.appId}\nException Type: EXC_CRASH (SIGABRT)\nTermination Reason: Namespace DYLD, Code 1 private-token\n`;
  const selected = selectOwnedMacCrashDiagnostic(text, ownership);
  assert.deepEqual(selected, { format: 'crash', reason: 'dynamic_loader', exception: 'EXC_CRASH', signal: 'SIGABRT', terminationNamespace: 'DYLD', terminationCode: 1 });
  assert.equal(JSON.stringify(selected).includes('private'), false);
  assert.equal(selectOwnedMacCrashDiagnostic(text.replace('[9818]', '[9819]'), ownership), null);
});

test('malformed, oversized and foreign diagnostic input is ignored rather than leaked', () => {
  for (const text of ['', 'private-token not json', '{"pid":', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    assert.equal(selectOwnedMacCrashDiagnostic(text, ownership), null);
  }
  const selected = selectOwnedMacCrashDiagnostic(ips({ ...report,
    exception: { type: 'private-token', signal: 'private-token' },
    termination: { namespace: 'private-token', code: 'private-token' } }), ownership);
  assert.deepEqual(selected, { format: 'ips', reason: 'unknown', exception: 'UNKNOWN', signal: 'UNKNOWN', terminationNamespace: 'UNKNOWN', terminationCode: null });
  assert.equal(JSON.stringify(selected).includes('private'), false);
});

test('direct-launch module diagnostics retain only a public basename and allowlisted error code', () => {
  const selected = diagnostics.classifyMacDirectLaunchOutput({
    stderr: "Uncaught Exception: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/private/private-token/storage.mjs' imported from /private/main.mjs", closed: true, code: 1,
  });
  assert.equal(selected.reason, 'module_missing');
  assert.equal(selected.errorCode, 'ERR_MODULE_NOT_FOUND');
  assert.equal(selected.file, 'storage.mjs');
  assert.equal(selected.exitCode, 1); assert.equal(selected.exited, true);
  assert.equal(JSON.stringify(selected).includes('private'), false);
});

test('direct-launch output distinguishes compile, profile, Singleton and signature failures', () => {
  for (const [stderr, reason] of [
    ['SyntaxError: Unexpected token at file:///private/main.mjs:12:1', 'module_compile'],
    ['Failed to create the user data directory /private/private-token', 'profile'],
    ['ProcessSingleton: Failed to create SingletonLock /private/private-token', 'singleton'],
    ['Code Signature Invalid private-token', 'code_signature'],
    ['EPERM private-token', 'permission'],
  ]) {
    const selected = diagnostics.classifyMacDirectLaunchOutput({ stderr, closed: true, code: 1 });
    assert.equal(selected.reason, reason);
    assert.equal(JSON.stringify(selected).includes('private'), false);
  }
});

test('unknown direct-launch text and private module basenames are never copied to evidence', () => {
  const selected = diagnostics.classifyMacDirectLaunchOutput({ stdout: 'user@example.test private-token',
    stderr: "Cannot find module '/private/private-token.js' ERR_PRIVATE_TOKEN", closed: true, code: 3, signal: 'PRIVATE_TOKEN' });
  assert.equal(selected.reason, 'module_missing'); assert.equal(selected.file, null); assert.equal(selected.errorCode, null);
  assert.equal(selected.stdoutPresent, true); assert.equal(selected.stderrPresent, true);
  assert.equal(selected.signal, 'UNKNOWN');
  assert.equal(JSON.stringify(selected).includes('private'), false);
});

test('a direct diagnostic staying alive is distinct from early normal or signaled exit', () => {
  assert.equal(diagnostics.classifyMacDirectLaunchOutput({ closed: false }).reason, 'alive_unknown');
  assert.equal(diagnostics.classifyMacDirectLaunchOutput({ closed: true, code: 0 }).reason, 'early_exit');
  const signaled = diagnostics.classifyMacDirectLaunchOutput({ closed: true, code: null, signal: 'SIGTRAP' });
  assert.equal(signaled.reason, 'early_failure'); assert.equal(signaled.signal, 'SIGTRAP');
});

test('direct diagnostics require every original PID gone and no unresolved owned or running app', () => {
  const value = { originalPids: [9818], missingPids: [9818], ownedStates: ['gone'], runningInstalledApplications: 0 };
  assert.equal(diagnostics.mayRunMacDirectLaunchDiagnostic(value), true);
  for (const changed of [
    { ...value, originalPids: [] }, { ...value, missingPids: [] },
    { ...value, ownedStates: ['gone', 'owned'] }, { ...value, ownedStates: ['unresolved'] },
    { ...value, runningInstalledApplications: 1 }, { ...value, originalPids: [9818, 9819] },
  ]) assert.equal(diagnostics.mayRunMacDirectLaunchDiagnostic(changed), false);
});

test('empty ownership cannot authorize app or profile removal while a direct child exit is unconfirmed', () => {
  for (const directChild of [{ closed: false }, {}, { closed: false, error: true }]) {
    assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: [], directChild }), false);
  }
  assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: [], directChild: null }), true);
  assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: [], directChild: { closed: true } }), true);
  assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: ['unresolved'], directChild: { closed: true } }), false);
  assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: ['owned'], directChild: null }), false);
});

test('cleanup permission changes only when the same direct child emits its actual close', () => {
  const directChild = { closed: false };
  assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: ['gone'], directChild }), false);
  directChild.error = true;
  assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: ['gone'], directChild }), false);
  directChild.closed = true;
  assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: ['gone'], directChild }), true);
});

test('an unadmitted original OS main PID still blocks app and profile cleanup', () => {
  assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: [], directChild: null, reportedMainStates: ['unresolved'] }), false);
  assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: [], directChild: { closed: true }, reportedMainStates: ['owned'] }), false);
  assert.equal(diagnostics.isMacInstalledCleanupSafe({ ownedStates: [], directChild: null, reportedMainStates: ['gone'] }), true);
});

test('reported main liveness preserves known PID reuse proof and treats unobserved living PIDs conservatively', () => {
  for (const signalProbe of ['present', 'unavailable', undefined]) {
    assert.equal(diagnostics.classifyReportedMacMainState({ signalProbe }), 'unresolved');
  }
  assert.equal(diagnostics.classifyReportedMacMainState({ signalProbe: 'missing' }), 'gone');
  assert.equal(diagnostics.classifyReportedMacMainState({ knownState: 'gone', signalProbe: 'present' }), 'gone');
  assert.equal(diagnostics.classifyReportedMacMainState({ knownState: 'owned' }), 'owned');
  assert.equal(diagnostics.classifyReportedMacMainState({ knownState: 'unresolved' }), 'unresolved');
});

const framework = ownership.executable.replace(/\/Contents\/MacOS\/[^/]+$/, '')
  + '/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework';
const images = [
  { name: 'Electron Framework', path: framework },
  { name: 'libsystem_kernel.dylib', path: '/usr/lib/system/libsystem_kernel.dylib' },
  { name: 'Electron Framework', path: '/private/private-token/Electron Framework' },
];

test('native crash facts use the faulting thread and public functions from owned Electron or known system images', () => {
  const value = { ...report, usedImages: images, faultingThread: 1, threads: [
    { triggered: true, frames: [{ imageIndex: 0, symbol: 'content::WrongThread()' }] },
    { frames: [{ imageIndex: 0, symbol: 'base::FilePath::Append(std::string const&)' },
      { imageIndex: 1, symbol: '__pthread_kill' },
      { imageIndex: 2, symbol: 'electron::PrivateImage()' }] },
  ] };
  const selected = selectOwnedMacCrashDiagnostic(ips(value), ownership);
  assert.equal(selected.nativeFrameSource, 'faulting_thread');
  assert.deepEqual(selected.nativeFrames, [
    { image: 'electron_framework', symbol: 'base::FilePath::Append' },
    { image: 'system_library', symbol: '__pthread_kill' },
  ]);
});

test('triggered-thread fallback rejects paths, private text, unknown namespaces and untrusted images', () => {
  const value = { ...report, usedImages: images, threads: [{ triggered: true, frames: [
    { imageIndex: 0, symbol: 'electron::BrowserMainParts::PreMainMessageLoopRun()' },
    { imageIndex: 0, symbol: '/Users/private/private-token/main.cc' },
    { imageIndex: 0, symbol: 'private-token private body' },
    { imageIndex: 0, symbol: 'CustomerSecret::PrivateToken()' },
    { imageIndex: 0, symbol: 'base::' + 'a'.repeat(181) },
    { imageIndex: 1, symbol: 'private_token_value' },
    { imageIndex: 2, symbol: 'base::FilePath::Append()' },
  ] }] };
  const selected = selectOwnedMacCrashDiagnostic(ips(value), ownership);
  assert.equal(selected.nativeFrameSource, 'triggered_thread');
  assert.deepEqual(selected.nativeFrames, [{ image: 'electron_framework', symbol: 'electron::BrowserMainParts::PreMainMessageLoopRun' }]);
  assert.equal(JSON.stringify(selected).includes('private'), false);
  assert.equal(JSON.stringify(selected).includes('/'), false);
});

test('public native frames remain bounded to eight function identifiers of at most 180 characters', () => {
  const value = { ...report, usedImages: images, faultingThread: 0,
    threads: [{ frames: Array.from({ length: 30 }, (_, index) => ({ imageIndex: 0, symbol: `base::Function${index}()` })) }] };
  const selected = selectOwnedMacCrashDiagnostic(ips(value), ownership);
  assert.equal(selected.nativeFrames.length, 8);
  assert.ok(selected.nativeFrames.every(frame => frame.symbol.length <= 180 && !/[\s/\\]/.test(frame.symbol)));
});

test('application-specific and termination text becomes only fixed fatal categories', () => {
  const value = { ...report, asi: { 'Electron Framework': ['Check failed: !IsPathAbsolute(path); profile user_data private-token'] },
    termination: { ...report.termination, details: ['Out of memory. dyld library not loaded. Code signature invalid /private/private-token'] } };
  const selected = selectOwnedMacCrashDiagnostic(ips(value), ownership);
  assert.deepEqual(selected.fatalCategories, ['profile', 'user_data', 'path_append', 'check_failed', 'oom', 'dyld', 'code_signature']);
  assert.equal(JSON.stringify(selected).includes('private'), false);
  assert.equal(selectOwnedMacCrashDiagnostic(ips({ ...value, pid: 777 }), ownership), null);
});

test('diagnostic-child console and owned crash reports share the same bounded fatal categories', () => {
  const message = 'Check failed: !IsPathAbsolute(path); profile user_data out of memory dyld Code signature invalid /private/private-token';
  const console = diagnostics.classifyMacDirectLaunchOutput({ stderr: message, closed: true, signal: 'SIGTRAP' });
  const crash = selectOwnedMacCrashDiagnostic(ips({ ...report, asi: { Electron: [message] } }), ownership);
  assert.deepEqual(console.fatalCategories, crash.fatalCategories);
  assert.equal(JSON.stringify(console).includes('private'), false);
});

test('fatal console sites retain only allowlisted native basenames and bounded positive lines', () => {
  for (const [stderr, file, line] of [
    ['[123:FATAL:async_wrap.cc(188)] Check failed: private-token /private/path', 'async_wrap.cc', 188],
    ['FATAL /private/path/electron_browser_main_parts.cc:241: private-token', 'electron_browser_main_parts.cc', 241],
    ['Assertion failed: (private-token), function X, file ../../src/node.cc, line 214.', 'node.cc', 214],
  ]) {
    const selected = diagnostics.classifyMacDirectLaunchOutput({ stderr, closed: true, signal: 'SIGTRAP' });
    assert.deepEqual(selected.nativeFatalSite, { file, line });
    assert.equal(JSON.stringify(selected).includes('private'), false);
  }
});

test('unknown native files, nonfatal frames and invalid line numbers are not published', () => {
  for (const stderr of ['FATAL private_token.cc(188) private-token', 'at async_wrap.cc:188 private-token',
    'FATAL async_wrap.cc(0)', 'FATAL async_wrap.cc(1234567)', 'FATAL private_async_wrap.cc(188)']) {
    assert.equal(diagnostics.classifyMacDirectLaunchOutput({ stderr }).nativeFatalSite, null);
  }
  const selected = diagnostics.classifyMacDirectLaunchOutput({ stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/private/storage.mjs'" });
  assert.equal(selected.file, 'storage.mjs');
});

test('official Electron logging is scoped to a copied child environment', () => {
  const inherited = { PATH: 'fixture-path', ELECTRON_ENABLE_LOGGING: 'false', FIXTURE_KEY: 'private-token' };
  const selected = diagnostics.macDiagnosticEnvironment(inherited);
  assert.equal(selected.ELECTRON_ENABLE_LOGGING, 'true');
  assert.equal(selected.ELECTRON_ENABLE_STACK_DUMPING, 'true');
  assert.equal(selected.PATH, inherited.PATH); assert.equal(selected.FIXTURE_KEY, inherited.FIXTURE_KEY);
  assert.deepEqual(inherited, { PATH: 'fixture-path', ELECTRON_ENABLE_LOGGING: 'false', FIXTURE_KEY: 'private-token' });
});
