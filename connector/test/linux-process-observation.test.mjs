import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinuxProcessTracker, inspectLinuxCommandLine, inspectInstalledProcessTree, readLinuxProcessStat } from '../scripts/linux-process-observation.mjs';

test('real NUL argv keeps URI boundaries; a flattened title is only an embedded-type observation', () => {
  const raw = Buffer.from('/opt/fixture/app\0--type=renderer\0private://connect?token=private\0');
  const actual = inspectLinuxCommandLine(raw);
  assert.equal(actual.type, 'renderer'); assert.equal(actual.hasType, true);
  assert.equal(actual.argv.length, 3); assert.equal(actual.nulCount, 3);
  assert.equal(actual.embeddedTypeCount, 0); assert.equal(actual.cmdlineBytes, raw.length);
  assert.equal(actual.argvEmptyCount, 1);
  assert.ok(actual.argv.includes('private://connect?token=private'));
  const flattened = inspectLinuxCommandLine(Buffer.from('/opt/fixture/app --type=renderer private://connect\0\0'));
  assert.equal(flattened.argv.length, 1); assert.equal(flattened.nulCount, 2);
  assert.equal(flattened.embeddedTypeCount, 1); assert.equal(flattened.type, 'untyped');
  assert.equal(flattened.hasType, false);
  assert.equal(flattened.argv.includes('private://connect'), false);
});

function entry(pid, parentPid, argumentsText = '/opt/fixture/app\0') {
  return { pid, parentPid, executable: '/opt/fixture/app', startTime: String(900 + pid),
    commandLine: inspectLinuxCommandLine(Buffer.from(argumentsText)) };
}

test('same executable seven times is one main only when the owned PID parent tree proves it', () => {
  const untyped = [entry(10, 1, '/opt/fixture/app\0private://connect\0'), entry(11, 10),
    entry(12, 10), entry(13, 12), entry(14, 12), entry(15, 12), entry(16, 10)];
  const unknownTypes = inspectInstalledProcessTree(untyped, '/opt/fixture/app');
  assert.deepEqual(unknownTypes.mains.map(value => value.pid), [10]);
  assert.equal(unknownTypes.diagnostics.types.untyped, 7);
  assert.equal(unknownTypes.diagnostics.renderer, 0, 'Parent linkage cannot invent renderer evidence');
  const entries = untyped.map(value => value.pid === 12 ? entry(12, 10, '/opt/fixture/app\0--type=zygote\0')
    : value.pid === 15 ? entry(15, 12, '/opt/fixture/app\0--type=renderer\0')
      : value.pid === 16 ? entry(16, 10, '/opt/fixture/app\0--type=utility\0') : value);
  const observed = inspectInstalledProcessTree(entries, '/opt/fixture/app');
  assert.deepEqual(observed.mains.map(value => value.pid), [10]);
  assert.deepEqual(observed.renderers.map(value => value.pid), [15]);
  assert.equal(observed.diagnostics.total, 7); assert.equal(observed.diagnostics.main, 1);
  assert.equal(observed.diagnostics.helper, 6); assert.equal(observed.diagnostics.parentLinked, 6);
  assert.equal(observed.diagnostics.types.untyped, 4);
  assert.equal(inspectInstalledProcessTree([...entries, entry(20, 1)], '/opt/fixture/app').mains.length, 2);
  const unrelated = entries.map(value => ({ ...value, parentPid: 1 }));
  assert.equal(inspectInstalledProcessTree(unrelated, '/opt/fixture/app').mains.length, 4);
});

test('empty argv, unknown/ambiguous flags, cycles, and orphan renderers cannot establish a healthy app tree', () => {
  const cases = [inspectLinuxCommandLine(Buffer.alloc(0)),
    inspectLinuxCommandLine('/opt/app\0--type=private-secret\0'),
    inspectLinuxCommandLine('/opt/app\0--type=renderer\0--type=zygote\0')];
  assert.deepEqual(cases.map(value => value.type), ['untyped', 'other', 'ambiguous']);
  assert.equal(inspectInstalledProcessTree([{ ...entry(1, 0), commandLine: cases[0] }], '/opt/fixture/app').mains.length, 0);
  const cycle = inspectInstalledProcessTree([entry(2, 3), entry(3, 2)], '/opt/fixture/app');
  assert.equal(cycle.mains.length, 0); assert.equal(cycle.diagnostics.cycleProcesses, 2);
  const orphan = inspectInstalledProcessTree([entry(10, 1), entry(20, 1, '/opt/app\0--type=renderer\0')], '/opt/fixture/app');
  assert.equal(orphan.diagnostics.disconnectedSameExecutable, 1);
  assert.equal(orphan.renderers.length, 0);
});

test('diagnostics contain only bounded counts, PID linkage and fixed type enums, never argv contents', () => {
  const entries = [entry(10, 1, '/opt/fixture/app\0private://connect?token=TOP_SECRET\0'),
    entry(11, 10, '/opt/fixture/app --type=renderer token=TOP_SECRET\0\0'),
    entry(12, 10, '/opt/app\0--type=TOP_SECRET\0')];
  const diagnostic = inspectInstalledProcessTree(entries, '/opt/fixture/app').diagnostics;
  assert.equal(diagnostic.embeddedTypeCount, 1); assert.equal(diagnostic.types.other, 1);
  assert.equal(diagnostic.argvCount, 5); assert.equal(diagnostic.nulCount, 6);
  assert.equal(diagnostic.argvEmptyCount, 4);
  assert.equal(diagnostic.cmdlineBytes, entries.reduce((total, value) => total + value.commandLine.cmdlineBytes, 0));
  const serialized = JSON.stringify(diagnostic);
  for (const secret of ['TOP_SECRET', 'private://', '/opt/', 'token=']) assert.equal(serialized.includes(secret), false);
});

test('stat parsing uses the last comm parenthesis and preserves actual PPID/start ticks', () => {
  const fields = Array(20).fill('0'); fields[0] = 'S'; fields[1] = '10'; fields[19] = '987654';
  assert.deepEqual(readLinuxProcessStat(`42 (fixture ) process) ${fields.join(' ')}`),
    { parentPid: 10, startTime: '987654' });
  assert.throws(() => readLinuxProcessStat('42 (truncated) S 1'));
});

test('access denial of a confirmed owned PID is not disappearance; changed start ticks exclude a reused PID', () => {
  const tracker = createLinuxProcessTracker();
  assert.equal(tracker.readDenied(99), null, 'Unreadable external PIDs may be skipped');
  tracker.remember(10, '100');
  assert.equal(tracker.reused(10, '100'), false);
  assert.throws(() => tracker.readDenied(10), error => error.code === 'OWNED_PROC_UNOBSERVABLE'
    && !error.message.includes('10') && !error.message.includes('100'));
  assert.equal(tracker.reused(10, '101'), true);
  assert.equal(tracker.has(10), false);
  assert.equal(tracker.readDenied(10), null, 'A reused PID is outside the old ownership');
  tracker.remember(10, '101');
  assert.throws(() => tracker.readDenied(10), { code: 'OWNED_PROC_UNOBSERVABLE' });
  tracker.forget(10);
  assert.equal(tracker.readDenied(10), null, 'A confirmed disappeared process loses its ownership record');
});
