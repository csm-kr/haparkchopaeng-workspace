import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

export async function canonicalMacPath(value, { resolvePath = realpath, allowMissing = false } = {}) {
  assert.ok(typeof value === 'string' && path.posix.isAbsolute(value) && !/[\u0000-\u001f\u007f]/.test(value), 'An absolute macOS path is required');
  let current = path.posix.resolve(value);
  const missing = [];
  for (;;) {
    try {
      const resolved = await resolvePath(current);
      assert.ok(path.posix.isAbsolute(resolved));
      // Preserve the filesystem's Unicode spelling for file URLs and actual IO.
      return path.posix.join(resolved, ...missing);
    } catch (error) {
      if (!allowMissing || error.code !== 'ENOENT' || current === '/') throw error;
      missing.unshift(path.posix.basename(current)); current = path.posix.dirname(current);
    }
  }
}

export async function sameMacPath(left, right, options) {
  return (await canonicalMacPath(left, options)).normalize('NFC') === (await canonicalMacPath(right, options)).normalize('NFC');
}

export async function assertMacPathInside(candidate, parent, options) {
  const child = await canonicalMacPath(candidate, options), owner = await canonicalMacPath(parent, options);
  const relative = path.posix.relative(owner.normalize('NFC'), child.normalize('NFC'));
  assert.ok(relative && relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative));
  return child;
}

function parsedBirth(value) {
  return typeof value === 'string' && /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[ \t]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[ \t]+\d{1,2}[ \t]+\d{1,2}:\d{2}:\d{2}[ \t]+\d{4}$/.test(value.trim())
    ? value.trim().replace(/[ \t]+/g, ' ') : null;
}

export async function resolveMacProcessIdentity(record, { resolvePath = realpath } = {}) {
  if (record.psExitCode !== 0) return { identity: null, reason: 'ps_exit' };
  const born = parsedBirth(record.psStart);
  if (!Number.isSafeInteger(record.pid) || record.pid <= 1 || !born) return { identity: null, reason: 'parse' };
  const options = { resolvePath }, application = record.application;
  if (record.main) {
    if (!application || application.pid !== record.pid || typeof application.path !== 'string' || typeof application.executable !== 'string') return { identity: null, reason: 'path_mismatch' };
    try { if (!await sameMacPath(application.path, record.ownedBundle, options)) return { identity: null, reason: 'path_mismatch' }; }
    catch { return { identity: null, reason: 'path_mismatch' }; }
  }
  if (application && application.pid !== record.pid) return { identity: null, reason: 'path_mismatch' };
  const candidate = application?.executable ?? record.command?.trim();
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || /[\r\n\u0000]/.test(candidate)) return { identity: null, reason: 'parse' };
  const executable = await canonicalMacPath(candidate, options).catch(() => null);
  if (!executable) return { identity: null, reason: 'no_file' };
  try { await assertMacPathInside(executable, record.ownedBundle, options); }
  catch { return { identity: null, reason: 'outside_owned' }; }
  return { identity: { pid: record.pid, born, executable, main: record.main === true }, reason: null };
}

export function classifyOwnedMacProcess(identity, observation) {
  if (observation.missing === true) return 'gone'; // ESRCH, not an arbitrary ps failure.
  const born = observation.psExitCode === 0 ? parsedBirth(observation.psStart) : null;
  if (!born) return 'unresolved';
  if (born !== identity.born) return 'gone';
  const current = observation.current;
  return current?.pid === identity.pid && current.born === identity.born
    && typeof current.executable === 'string' && current.executable.normalize('NFC') === identity.executable.normalize('NFC')
    ? 'owned' : 'unresolved';
}
