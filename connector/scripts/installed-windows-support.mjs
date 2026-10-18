import assert from 'node:assert/strict';
import { win32 as path } from 'node:path';

export const WINDOWS_COLD_ERROR = '연결 링크에 허용되지 않은 정보가 있어요.';
export const WINDOWS_WARM_ERROR = '등록된 앱의 연결 링크를 사용해 주세요.';

function isCanonicalWindowsSid(value) {
  if (typeof value !== 'string' || value.trim() !== value || value.length > 184
    || !/^S-1-(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*)){1,15}$/.test(value)) return false;
  const [, , authority, ...subauthorities] = value.split('-');
  return BigInt(authority) <= 0xffffffffffffn && subauthorities.every(part => BigInt(part) <= 0xffffffffn);
}

export function assertWindowsTokenContext(context) {
  assert.ok(isCanonicalWindowsSid(context?.sid) && /^S-1-5-21-\d+-\d+-\d+-\d+$/.test(context.sid), 'A current Windows user SID is required');
  assert.ok(isCanonicalWindowsSid(context?.tokenOwnerSid), 'The current token default owner SID is unavailable or invalid');
}

export function windowsNativeFailure(error, operation) {
  const operations = new Set(['context', 'protocol', 'path', 'processes', 'identity', 'open', 'window', 'close', 'kill', 'listeners']);
  const stderr = typeof error?.result?.stderr === 'string' ? error.result.stderr.slice(0, 64_000) : '';
  let stderrCategory = 'NONE';
  if (error?.code === 'ENOENT') stderrCategory = 'NATIVE_NOT_FOUND';
  else if (error?.code === 'ETIMEDOUT') stderrCategory = 'NATIVE_TIMEOUT';
  else if (/ParserError|MissingEndCurlyBrace|UnexpectedToken|TerminatorExpectedAtEndOfString/i.test(stderr)) stderrCategory = 'POWERSHELL_PARSE';
  else if (/Add-Type|CompilerErrors|\bCS\d{4}\b/i.test(stderr)) stderrCategory = 'POWERSHELL_COMPILE';
  else if (/UnauthorizedAccess|AccessDenied|Access is denied|PermissionDenied/i.test(stderr)) stderrCategory = 'POWERSHELL_ACCESS';
  else if (/OWNER_UNAVAILABLE|GetOwnerSid|CimException|Get-CimInstance|Invoke-CimMethod/i.test(stderr)) stderrCategory = 'POWERSHELL_CIM';
  else if (stderr) stderrCategory = 'POWERSHELL_OTHER';
  const result = { operation: operations.has(operation) ? operation : 'unknown',
    exitCode: Number.isSafeInteger(error?.result?.code) ? error.result.code : null, stderrCategory };
  if (operation === 'path' && typeof error?.result?.stdout === 'string' && error.result.stdout.length < 64_000) {
    try {
      const value = JSON.parse(error.result.stdout.replace(/^\uFEFF/, '').trim()).nativeDiagnostic;
      const stages = new Set(['exists', 'item', 'acl', 'owner_sid', 'response']);
      const types = new Set(['UnauthorizedAccessException', 'SecurityException', 'IdentityNotMappedException', 'ArgumentException',
        'ArgumentNullException', 'ItemNotFoundException', 'InvalidOperationException', 'IOException', 'Win32Exception',
        'MethodInvocationException', 'ParameterBindingException', 'CommandNotFoundException', 'RuntimeException', 'PathTooLongException', 'UNKNOWN']);
      if (stages.has(value?.pathStage)) result.pathStage = value.pathStage;
      if (types.has(value?.exceptionType)) result.exceptionType = value.exceptionType;
    } catch { /* Raw native output is never copied to diagnostics. */ }
  }
  return result;
}

export function windowsAbsolute(value) {
  assert.ok(typeof value === 'string' && path.isAbsolute(value) && path.parse(value).root.length > 1 && !/[\p{Cc}\p{Cf}]/u.test(value), 'A fully qualified Windows path is required');
  return path.resolve(value);
}

export function sameWindowsPath(first, second) {
  return typeof first === 'string' && typeof second === 'string'
    && windowsAbsolute(first).toLowerCase() === windowsAbsolute(second).toLowerCase();
}

export function windowsInside(candidate, parent) {
  const resolved = windowsAbsolute(candidate), relative = path.relative(windowsAbsolute(parent), resolved);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Windows path escaped its exact owner');
  return resolved;
}

export function assertWindowsRunner(env, { platform, workspace }) {
  assert.equal(platform, 'win32', 'Installed Windows URI smoke requires native Windows');
  assert.equal(env.CI, 'true'); assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'A disposable hosted runner is required');
  assert.equal(env.RUNNER_OS, 'Windows'); assert.equal(env.LOCAL_AGENT_INSTALL_QA, '1');
  const runnerTemp = windowsAbsolute(env.RUNNER_TEMP), actualWorkspace = windowsAbsolute(workspace);
  assert.ok(sameWindowsPath(env.GITHUB_WORKSPACE, actualWorkspace), 'Unexpected workspace');
  assert.notEqual(runnerTemp, path.parse(runnerTemp).root, 'Runner temp cannot be a drive root');
  assert.ok(!sameWindowsPath(runnerTemp, actualWorkspace), 'Runner temp must be separate');
  const fromWorkspace = path.relative(actualWorkspace, runnerTemp);
  assert.ok(path.isAbsolute(fromWorkspace) || fromWorkspace === '..' || fromWorkspace.startsWith(`..${path.sep}`), 'Runner temp cannot be inside the workspace');
  return { workspace: actualWorkspace, runnerTemp };
}

export function parseWindowsSmokeArguments(argv) {
  let installation, preflight = false;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--installation' && installation === undefined && typeof argv[index + 1] === 'string' && !argv[index + 1].startsWith('--')) installation = argv[++index];
    else if (argv[index] === '--preflight' && !preflight) preflight = true;
    else assert.fail('Only an owned installation and optional preflight are accepted');
  }
  assert.ok(installation, 'Explicit installation is required');
  windowsAbsolute(installation);
  return { installation, preflight };
}

export function windowsSmokeLayout(configuration, { applicationId, executableName } = {}) {
  assert.match(applicationId ?? '', /^[a-z][a-z0-9-]{0,80}$/);
  assert.match(configuration?.appId ?? '', /^[a-zA-Z][a-zA-Z0-9.-]{3,180}$/);
  assert.ok(!configuration.appId.includes('..') && !configuration.appId.endsWith('.'));
  assert.match(configuration.scheme ?? '', /^[a-z][a-z0-9+.-]{2,63}$/);
  assert.ok(!['http', 'https', 'file', 'data', 'javascript'].includes(configuration.scheme));
  const filename = executableName ?? configuration.productName;
  assert.ok(typeof filename === 'string' && filename.length > 0 && filename.length <= 120
    && !/[<>:"/\\|?*\p{Cc}\p{Cf}]/u.test(filename) && filename.trim() === filename
    && !filename.endsWith('.') && !filename.toLowerCase().endsWith('.exe') && !['.', '..'].includes(filename)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename), 'Unsafe Windows executable name');
  const relative = configuration.profileRelativePath;
  assert.ok(Array.isArray(relative));
  if (relative.length) assert.deepEqual(relative, [configuration.appId, 'production']);
  const profileRelativePath = relative.length ? [...relative] : [configuration.productName];
  assert.ok(profileRelativePath.every(value => typeof value === 'string' && value && path.basename(value) === value && !/[<>:"/\\|?*\p{Cc}\p{Cf}]/u.test(value) && !['.', '..'].includes(value)));
  return { appId: configuration.appId, productName: configuration.productName, scheme: configuration.scheme,
    executableFilename: `${filename}.exe`, profileRelativePath, installationPrefix: `${applicationId}-connector-install-` };
}

export function assertOwnedWindowsInstallation(installation, runnerTemp, prefix) {
  assert.match(prefix, /^[a-z][a-z0-9-]{0,80}-connector-install-$/);
  const resolved = windowsInside(installation, runnerTemp), child = path.relative(windowsAbsolute(runnerTemp), resolved);
  assert.ok(!child.includes(path.sep) && child.startsWith(prefix) && /^[a-f0-9]{32}$/i.test(child.slice(prefix.length)), 'Only the exact host GUID installation can be inspected');
  return resolved;
}

function creationStamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?Z$/.exec(value);
  return match ? `${match[1]}.${(match[2] ?? '').padEnd(7, '0')}Z` : null;
}

export function assertWindowsProcessIdentity(row, { installation, executable, sid, notBefore }) {
  assert.ok(row && Number.isSafeInteger(row.pid) && row.pid > 1 && Array.isArray(row.argv));
  windowsInside(row.executable, installation);
  if (executable) assert.ok(sameWindowsPath(row.executable, executable), 'Not the exact installed executable');
  assert.ok(typeof sid === 'string' && /^S-1-5-21-\d+-\d+-\d+-\d+$/.test(sid) && row.sid === sid, 'Not the current runner user');
  assert.ok(creationStamp(row.createdAt) && Number.isFinite(notBefore)
    && Date.parse(row.createdAt) >= notBefore - 2_000, 'A prior or unknown process must be preserved');
  return { pid: row.pid, executable: row.executable, sid: row.sid, createdAt: row.createdAt };
}

export function sameWindowsProcess(row, identity) {
  return !!row && row.pid === identity.pid && row.sid === identity.sid && creationStamp(row.createdAt) && creationStamp(row.createdAt) === creationStamp(identity.createdAt)
    && sameWindowsPath(row.executable, identity.executable);
}

export function classifyWindowsKnownProcess(observation, identity) {
  const unavailable = () => { throw Object.assign(new Error('Known installed process identity cannot be verified'), { code: 'PROCESS_OBSERVATION_UNAVAILABLE' }); };
  const mismatch = () => { throw Object.assign(new Error('Known installed process identity does not match'), { code: 'PROCESS_IDENTITY_MISMATCH' }); };
  if (!observation || typeof observation.exists !== 'boolean') return unavailable();
  if (!observation.exists) return 'gone';
  const observed = creationStamp(observation.createdAt), original = creationStamp(identity.createdAt);
  if (!observed || !original) return unavailable();
  if (observed !== original) return 'gone';
  if (!Number.isSafeInteger(observation.pid) || observation.pid <= 1 || !isCanonicalWindowsSid(observation.sid)
    || typeof observation.executable !== 'string') return unavailable();
  let pathMatches;
  try { pathMatches = sameWindowsPath(observation.executable, identity.executable); }
  catch { return unavailable(); }
  if (observation.pid !== identity.pid || observation.sid !== identity.sid || !pathMatches) return mismatch();
  return 'running';
}

export function windowsOwnedProcessesStopped(rows, observations) {
  assert.ok(Array.isArray(rows) && Array.isArray(observations), 'Installed process observations are required');
  const states = observations.map(({ identity, observation }) => {
    try { return classifyWindowsKnownProcess(observation, identity); }
    catch (error) {
      if (error.code === 'PROCESS_OBSERVATION_UNAVAILABLE') return 'pending';
      throw error;
    }
  });
  return rows.length === 0 && states.every(state => state === 'gone');
}

export function windowsProcessObservation(observation, { executable, uri }) {
  const rows = Array.isArray(observation?.processes) ? observation.processes : [];
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
  const nativeCountsObserved = count(observation?.counts?.installedPathRows) && count(observation?.counts?.otherUserRows);
  const mains = rows.filter(row => sameWindowsPath(row.executable, executable) && Array.isArray(row.argv)
    && !row.argv.some(arg => typeof arg === 'string' && arg.startsWith('--type=')));
  return { nativeCountsObserved, installedPathRows: nativeCountsObserved ? observation.counts.installedPathRows : 0,
    otherUserRows: nativeCountsObserved ? observation.counts.otherUserRows : 0, currentUserRows: rows.length,
    mainRows: mains.length, exactUriRows: mains.filter(row => row.argv.includes(uri)).length };
}

export function windowsControlledUriObservation(rows, { executable, uri }) {
  assert.match(uri, /^[a-z][a-z0-9+.-]{2,63}:\/\/connect\?attemptId=ci-package-cold$/,
    'URI diagnostics accept only the fixed synthetic cold input');
  const expected = new URL(uri), token = 'ci-package-cold';
  const mains = rows.filter(row => sameWindowsPath(row.executable, executable) && Array.isArray(row.argv)
    && !row.argv.some(arg => typeof arg === 'string' && arg.startsWith('--type=')));
  const args = mains.flatMap(row => row.argv).filter(arg => typeof arg === 'string').slice(0, 1024);
  const candidates = args.filter(arg => {
    if (arg.toLowerCase().includes(token)) return true;
    try { return decodeURIComponent(arg).toLowerCase().includes(token); } catch { return false; }
  });
  const parsed = candidates.map(arg => { try { return new URL(arg); } catch { return null; } }).filter(Boolean);
  const decodedMatches = arg => { try { return new URL(decodeURIComponent(arg)).href === expected.href; } catch { return false; } };
  return { mainArgCount: args.length, schemeArgCount: args.filter(arg => arg.toLowerCase().startsWith(expected.protocol)).length,
    controlledTokenArgCount: candidates.length, maxCandidateCharacters: Math.min(4096, Math.max(0, ...candidates.map(arg => arg.length))),
    rawExactMatch: candidates.includes(uri), caseFoldMatch: candidates.some(arg => arg.toLowerCase() === uri.toLowerCase()),
    urlCanonicalMatch: parsed.some(value => value.href === expected.href), percentDecodedMatch: candidates.some(decodedMatches),
    exactControlledUriWithSlash: candidates.includes(uri.replace('://connect?', '://connect/?')),
    pathnameEmptyOrSlash: parsed.some(value => value.pathname === '' || value.pathname === '/'),
    unquotedMatch: candidates.some(arg => arg === `"${uri}"` || arg === `'${uri}'`),
    queryKeysMatch: parsed.some(value => { const keys = [...value.searchParams.keys()]; return keys.length === 1 && keys[0] === 'attemptId'; }),
    attemptValueMatch: parsed.some(value => { const values = value.searchParams.getAll('attemptId'); return values.length === 1 && values[0] === token; }) };
}

export function captureWindowsColdUriSnapshot(rows, options) {
  const observation = windowsControlledUriObservation(rows, options);
  assert.ok(observation.rawExactMatch || observation.exactControlledUriWithSlash, 'The controlled cold URI was not observed');
  return Object.freeze({ exactUriArgumentObserved: observation.rawExactMatch,
    controlledUriArgumentObserved: true, normalizedRootSlashObserved: observation.exactControlledUriWithSlash,
    uriArgumentObservation: Object.freeze(observation) });
}

export function selectWindowsMain(rows, options) {
  const mains = rows.filter(row => sameWindowsPath(row.executable, options.executable) && Array.isArray(row.argv) && !row.argv.some(arg => arg.startsWith('--type=')));
  assert.ok(mains.length <= 1, 'More than one installed main process is running');
  if (!mains.length) return null;
  const identity = assertWindowsProcessIdentity(mains[0], options);
  const rootSlash = /^[a-z][a-z0-9+.-]{2,63}:\/\/connect\?attemptId=ci-package-cold$/.test(options.uri ?? '')
    ? options.uri.replace('://connect?', '://connect/?') : null;
  return !options.uri || mains[0].argv.includes(options.uri) || (rootSlash && mains[0].argv.includes(rootSlash)) ? identity : null;
}

export function windowsSmokeUris(layout) {
  return { cold: `${layout.scheme}://connect?attemptId=ci-package-cold`, warm: `${layout.scheme}://invalid` };
}

export function assertWindowsRejectedState(state, description) {
  assert.equal(state.stage, 'error'); assert.equal(state.description, description);
  assert.equal(state.attemptId, null); assert.deepEqual(state.providers, []);
  assert.equal(state.autoStart, false); assert.equal(state.pet, false);
}

export function windowsProfileObservation(descriptor, { profile, sid, tokenOwnerSid, notBefore }) {
  const matches = (first, second) => { try { return sameWindowsPath(first, second); } catch { return false; } };
  return { exists: descriptor?.exists === true, directory: descriptor?.directory === true,
    reparsePoint: descriptor?.reparsePoint === true, exactPathMatches: matches(descriptor?.path, profile),
    realPathMatches: matches(descriptor?.realPath, profile), currentUserOwner: descriptor?.sid === sid,
    administratorsOwner: descriptor?.sid === 'S-1-5-32-544',
    ...(tokenOwnerSid !== undefined ? { currentTokenOwner: isCanonicalWindowsSid(tokenOwnerSid) && descriptor?.sid === tokenOwnerSid } : {}),
    createdAfterStart: Number.isFinite(Date.parse(descriptor?.createdAt)) && Number.isFinite(notBefore)
      && Date.parse(descriptor.createdAt) >= notBefore - 2_000 };
}

export function assertFreshWindowsProfile(descriptor, { appData, profile, sid, tokenOwnerSid, notBefore, existedBefore }) {
  assert.equal(existedBefore, false, 'Existing profiles must be preserved');
  if (tokenOwnerSid !== undefined) assert.ok(isCanonicalWindowsSid(tokenOwnerSid), 'A valid captured token default owner is required');
  windowsInside(profile, appData);
  assert.ok(sameWindowsPath(descriptor.path, profile), 'Unexpected profile cleanup target');
  if (!descriptor.exists) return;
  assert.ok(descriptor.directory && !descriptor.reparsePoint && sameWindowsPath(descriptor.realPath, profile), 'A redirected profile must be preserved');
  assert.ok(descriptor.sid === sid || (tokenOwnerSid !== undefined && descriptor.sid === tokenOwnerSid), 'The profile owner does not match this runner or its captured token default');
  assert.ok(Number.isFinite(Date.parse(descriptor.createdAt)) && Date.parse(descriptor.createdAt) >= notBefore - 2_000, 'A prior profile must be preserved');
}

export function assertWindowsProtocolCommand(command, executable) {
  windowsAbsolute(executable);
  assert.ok(typeof command === 'string' && command.toLowerCase() === `"${executable}" "%1"`.toLowerCase(), 'The OS protocol must point only to the exact installed executable and URI');
}
