import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { assertMacPathInside, canonicalMacPath, classifyOwnedMacProcess, resolveMacProcessIdentity, sameMacPath } from '../scripts/installed-macos-identity.mjs';

const bundle = '/Applications/connector-ci-owned/하박조팽 연결기.app';
const executable = `${bundle}/Contents/MacOS/하박조팽 연결기`;
const helper = `${bundle}/Contents/Frameworks/하박조팽 연결기 Helper.app/Contents/MacOS/하박조팽 연결기 Helper`;
const start = 'Sat Oct 17 13:31:18 2026';
const missing = () => Object.assign(new Error('Fixture path absent'), { code: 'ENOENT' });
function resolver(value) {
  const normalized = path.posix.resolve(value).normalize('NFC');
  if (normalized.startsWith('/var/folders/')) return Promise.resolve(`/private${normalized}`);
  if (normalized.startsWith('/private/var/folders/') && !normalized.endsWith('/new-profile')) return Promise.resolve(normalized);
  if ([bundle, executable, helper, '/Applications', '/Applications/connector-ci-owned', '/outside/Other.app', '/outside/Other.app/Contents/MacOS/Other'].includes(normalized)) return Promise.resolve(normalized.normalize('NFD'));
  if (normalized === `${bundle}/escape`) return Promise.resolve('/outside/Other.app');
  return Promise.reject(missing());
}
const options = { resolvePath: resolver };
const main = { pid: 9758, psExitCode: 0, psStart: start, ownedBundle: bundle, main: true,
  application: { pid: 9758, path: bundle, executable, started: 1_792_242_678 }, command: executable };

test('canonical containment accepts the same macOS temp location through /var and /private/var', async () => {
  assert.equal(await assertMacPathInside('/private/var/folders/owned/child', '/var/folders/owned', options), '/private/var/folders/owned/child');
});
test('canonical equality handles Unicode normalization and filesystem aliases together', async () => {
  assert.equal(await sameMacPath('/var/folders/owned/연결기'.normalize('NFD'), '/private/var/folders/owned/연결기', options), true);
});
test('canonical containment rejects a symlink resolving outside the owned bundle', async () => {
  await assert.rejects(assertMacPathInside(`${bundle}/escape`, bundle, options));
});
test('a missing profile uses its existing canonical ancestor without widening ownership', async () => {
  assert.equal(await canonicalMacPath('/private/var/folders/owned/new-profile', { ...options, allowMissing: true }), '/private/var/folders/owned/new-profile');
  await assert.rejects(canonicalMacPath('/private/var/folders/owned/new-profile', options));
});
test('main ownership uses the OS application executable even when ps comm is escaped or only a name', async () => {
  for (const command of ['????', '하박조팽 연결기', '/Applications/escaped/\\355\\225\\230.app']) {
    const result = await resolveMacProcessIdentity({ ...main, command }, options);
    assert.equal(result.reason, null);
    assert.equal(result.identity.executable, executable.normalize('NFD'));
    assert.equal(result.identity.born, start);
    assert.equal(result.identity.main, true);
  }
});
test('main ownership requires the same PID and exact installed app bundle', async () => {
  for (const application of [null, { ...main.application, pid: 1 }, { ...main.application, path: '/outside/Other.app' }]) {
    const result = await resolveMacProcessIdentity({ ...main, application }, options);
    assert.equal(result.identity, null); assert.equal(result.reason, 'path_mismatch');
  }
});
test('helper fallback accepts only a canonical executable inside the copied bundle', async () => {
  const result = await resolveMacProcessIdentity({ ...main, main: false, application: null, command: helper, psStart: ' Sun  Oct  4  03:04:05  2026\n' }, options);
  assert.equal(result.identity.executable, helper.normalize('NFD'));
  assert.equal(result.identity.born, 'Sun Oct 4 03:04:05 2026');
  assert.equal((await resolveMacProcessIdentity({ ...main, main: false, application: null, command: 'Helper' }, options)).reason, 'parse');
});
test('identity rejection reasons stay bounded and never include a raw path or ps row', async () => {
  const cases = [
    [{ ...main, psExitCode: 1 }, 'ps_exit'],
    [{ ...main, psStart: 'unexpected output /private/path' }, 'parse'],
    [{ ...main, application: { ...main.application, executable: '/missing/executable' } }, 'no_file'],
    [{ ...main, application: { ...main.application, executable: '/outside/Other.app/Contents/MacOS/Other' } }, 'outside_owned'],
  ];
  for (const [record, reason] of cases) assert.deepEqual(await resolveMacProcessIdentity(record, options), { identity: null, reason });
});

const owned = { pid: 9758, born: start, executable };
test('an alive same-birth PID with an unobservable executable is neither stopped nor safe to signal', () => {
  for (const observation of [
    { current: null, psExitCode: 0, psStart: start },
    { current: null, psExitCode: 1, psStart: '' },
    { current: null, psExitCode: 127, psStart: '' },
    { current: null, psExitCode: 0, psStart: 'unparseable' },
  ]) assert.equal(classifyOwnedMacProcess(owned, observation), 'unresolved');
});
test('only ESRCH or a newly observed birth proves the former owned PID is gone', () => {
  assert.equal(classifyOwnedMacProcess(owned, { current: null, missing: true, psExitCode: 1, psStart: '' }), 'gone');
  assert.equal(classifyOwnedMacProcess(owned, { current: null, psExitCode: 0, psStart: 'Sat Oct 17 13:31:19 2026' }), 'gone');
});
test('only an exact current executable, PID and birth grants permission to signal', () => {
  assert.equal(classifyOwnedMacProcess(owned, { current: { ...owned, executable: executable.normalize('NFD') }, psExitCode: 0, psStart: start }), 'owned');
  for (const current of [{ ...owned, executable: '/outside/Other' }, { ...owned, pid: 9759 }, { ...owned, born: 'different' }]) {
    assert.equal(classifyOwnedMacProcess(owned, { current, psExitCode: 0, psStart: start }), 'unresolved');
  }
});
