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
