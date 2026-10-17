/** Pure observations: callers must first establish executable/UID ownership. */
import assert from 'node:assert/strict';
const knownTypes = ['renderer', 'zygote', 'gpu-process', 'utility', 'broker', 'crashpad-handler', 'ppapi', 'ppapi-broker', 'relauncher'];

export function createLinuxProcessTracker() {
  const tracked = new Map();
  return {
    remember(pid, startTime) { tracked.set(Number(pid), startTime); },
    has(pid) { return tracked.has(Number(pid)); },
    forget(pid) { tracked.delete(Number(pid)); },
    reused(pid, startTime) {
      if (!tracked.has(Number(pid)) || tracked.get(Number(pid)) === startTime) return false;
      tracked.delete(Number(pid)); return true;
    },
    readDenied(pid) {
      if (!tracked.has(Number(pid))) return null;
      throw Object.assign(new Error('A confirmed owned process cannot be observed; retain it for runner disposal.'),
        { code: 'OWNED_PROC_UNOBSERVABLE' });
    },
  };
}

export function inspectLinuxCommandLine(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const text = bytes.toString('utf8'), fields = text.split('\0');
  const argv = fields.filter(Boolean);
  const typeArguments = argv.filter(argument => argument === '--type' || argument.startsWith('--type='));
  let type = 'untyped';
  if (typeArguments.length > 1) type = 'ambiguous';
  else if (typeArguments.length === 1) {
    const value = typeArguments[0].slice('--type='.length);
    type = knownTypes.includes(value) ? value : 'other';
  }
  // A process title can contain spaces, flags, or secrets. Do not reconstruct
  // argv from those words or promote an embedded flag into a renderer proof.
  const embeddedTypeCount = argv.filter(argument => !typeArguments.includes(argument))
    .reduce((count, argument) => count + [...argument.matchAll(/(?:^|\s)--type=[^\s]+(?=\s|$)/g)].length, 0);
  return { argv, type, hasType: typeArguments.length > 0, embeddedTypeCount,
    cmdlineBytes: bytes.length, nulCount: fields.length - 1,
    argvEmptyCount: fields.filter(field => field.length === 0).length };
}

export function observeSyntheticUri(commandLine, uri) {
  assert.ok(typeof uri === 'string' && uri.length > 0 && !/\s/.test(uri));
  const exactCmdlineField = commandLine.argv.includes(uri);
  // Linux permits a process to replace its command line with a display title.
  // Record an exact synthetic token without interpreting title words as argv.
  const titleToken = commandLine.argv.some(field => {
    let offset = field.indexOf(uri);
    while (offset !== -1) {
      const end = offset + uri.length;
      if ((offset === 0 || /\s/.test(field[offset - 1]))
        && (end === field.length || /\s/.test(field[end]))) return true;
      offset = field.indexOf(uri, offset + 1);
    }
    return false;
  });
  return { observed: exactCmdlineField || titleToken,
    source: exactCmdlineField ? 'nul-delimited-cmdline-field' : titleToken ? 'process-title-token' : 'unobserved',
    exactCmdlineField, originalArgvProven: false };
}

export function readLinuxProcessStat(text) {
  const closing = text.lastIndexOf(')');
  const fields = text.slice(closing + 2).trim().split(/\s+/);
  assert.ok(closing > 0 && fields.length >= 20 && /^\d+$/.test(fields[1]) && /^\d+$/.test(fields[19]),
    'Cannot observe the installed process parent and start time.');
  const parentPid = Number(fields[1]);
  assert.ok(Number.isSafeInteger(parentPid) && parentPid >= 0);
  return { parentPid, startTime: fields[19] };
}

export function inspectInstalledProcessTree(entries, executable) {
  const byPid = new Map(entries.map(entry => [entry.pid, entry]));
  assert.equal(byPid.size, entries.length, 'Duplicate installed PID observations.');
  for (const entry of entries) assert.ok(Number.isSafeInteger(entry.pid) && entry.pid > 0
    && Number.isSafeInteger(entry.parentPid) && entry.parentPid >= 0, 'Invalid installed process hierarchy.');
  const ancestry = new Map(entries.map(entry => {
    let current = entry; const seen = new Set([entry.pid]);
    while (byPid.has(current.parentPid)) {
      if (seen.has(current.parentPid)) return [entry.pid, null];
      seen.add(current.parentPid); current = byPid.get(current.parentPid);
    }
    return [entry.pid, current.pid];
  }));
  const mains = entries.filter(entry => entry.executable === executable && !byPid.has(entry.parentPid)
    && !entry.commandLine.hasType && !entry.commandLine.embeddedTypeCount && entry.commandLine.argv.length > 0);
  const mainPids = new Set(mains.map(entry => entry.pid));
  const renderers = entries.filter(entry => entry.commandLine.type === 'renderer' && mainPids.has(ancestry.get(entry.pid)));
  const types = Object.fromEntries(['untyped', ...knownTypes, 'other', 'ambiguous'].map(type => [type, 0]));
  for (const entry of entries) types[entry.commandLine.type] += 1;
  const diagnostics = { total: entries.length, main: mains.length, helper: entries.length - mains.length,
    renderer: renderers.length, parentLinked: entries.filter(entry => byPid.has(entry.parentPid)).length,
    roots: entries.filter(entry => !byPid.has(entry.parentPid)).length,
    cycleProcesses: entries.filter(entry => ancestry.get(entry.pid) === null).length,
    disconnectedSameExecutable: entries.filter(entry => entry.executable === executable && !mainPids.has(ancestry.get(entry.pid))).length,
    types };
  for (const metric of ['cmdlineBytes', 'nulCount', 'argvEmptyCount', 'embeddedTypeCount']) {
    diagnostics[metric] = entries.reduce((count, entry) => count + entry.commandLine[metric], 0);
  }
  diagnostics.argvCount = entries.reduce((count, entry) => count + entry.commandLine.argv.length, 0);
  diagnostics.emptyCmdlineProcesses = entries.filter(entry => entry.commandLine.cmdlineBytes === 0).length;
  diagnostics.processes = entries.slice(0, 32).map(entry => ({
    pid: entry.pid, parentInstalled: byPid.has(entry.parentPid), rootCandidate: mainPids.has(entry.pid),
    type: entry.commandLine.type, argvCount: entry.commandLine.argv.length,
    cmdlineBytes: entry.commandLine.cmdlineBytes, nulCount: entry.commandLine.nulCount,
    argvEmptyCount: entry.commandLine.argvEmptyCount, embeddedTypeCount: entry.commandLine.embeddedTypeCount,
  }));
  return { mains, renderers, diagnostics };
}

export function verifyLinuxCdpRenderers(entries, { executable, mainPid, uid }, nativeProcesses) {
  assert.ok(Number.isSafeInteger(mainPid) && mainPid > 0 && Number.isSafeInteger(uid) && uid > 0);
  assert.ok(Array.isArray(nativeProcesses));
  const seen = new Set();
  for (const process of nativeProcesses) {
    assert.ok(Number.isSafeInteger(process.id) && process.id > 0 && !seen.has(process.id)
      && typeof process.type === 'string', 'Invalid native process observations.');
    seen.add(process.id);
  }
  const browsers = nativeProcesses.filter(process => process.type === 'browser');
  assert.equal(browsers.length, 1, 'Exactly one CDP browser process is required.');
  assert.equal(browsers[0].id, mainPid, 'CDP browser must be the directly launched installed process.');
  const observed = inspectInstalledProcessTree(entries, executable);
  assert.equal(observed.mains.length, 1);
  assert.equal(observed.mains[0].pid, mainPid);
  assert.equal(observed.diagnostics.disconnectedSameExecutable, 0);
  assert.equal(observed.diagnostics.cycleProcesses, 0);
  const byPid = new Map(entries.map(entry => [entry.pid, entry]));
  const assertOwner = entry => {
    assert.ok(entry && entry.executable === executable, 'CDP process must match the installed executable.');
    assert.equal(Number(/^Uid:\s+(\d+)/m.exec(entry.status)?.[1]), uid, 'CDP process must match the OS owner.');
  };
  assertOwner(byPid.get(mainPid));
  const renderers = nativeProcesses.filter(process => process.type === 'renderer');
  assert.ok(renderers.length > 0, 'CDP must report at least one native renderer process.');
  return renderers.map(process => {
    const entry = byPid.get(process.id);
    assertOwner(entry);
    let ancestor = entry;
    const ancestors = new Set([entry.pid]);
    while (ancestor.pid !== mainPid) {
      ancestor = byPid.get(ancestor.parentPid);
      assert.ok(ancestor && !ancestors.has(ancestor.pid), 'Native renderer must descend from the owned browser.');
      ancestors.add(ancestor.pid);
    }
    assert.equal(/^Seccomp:\s+(\d+)/m.exec(entry.status)?.[1], '2');
    assert.equal(/^NoNewPrivs:\s+(\d+)/m.exec(entry.status)?.[1], '1');
    return entry;
  });
}
