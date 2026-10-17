// Keep raw macOS reports and signature output in memory; evidence uses fixed enums only.
const maximumReportLength = 2 * 1024 * 1024;
const exceptions = new Set(['EXC_CRASH', 'EXC_BAD_ACCESS', 'EXC_BREAKPOINT', 'EXC_GUARD', 'EXC_RESOURCE',
  'EXC_BAD_INSTRUCTION', 'EXC_SOFTWARE', 'EXC_ARITHMETIC']);
const signals = new Set(['SIGABRT', 'SIGKILL', 'SIGSEGV', 'SIGTRAP', 'SIGBUS', 'SIGILL', 'SIGTERM']);
const namespaces = new Set(['CODESIGNING', 'DYLD', 'SIGNAL', 'TCC', 'RUNNINGBOARD', 'WATCHDOG',
  'LIBSYSTEM', 'ENDPOINTSECURITY', 'GUARD', 'JETSAM']);
const selected = (value, allowed) => allowed.has(value) ? value : 'UNKNOWN';
const samePath = (left, right) => typeof left === 'string' && typeof right === 'string'
  && left.startsWith('/') && right.startsWith('/') && left.normalize('NFC') === right.normalize('NFC');
const publicFiles = new Set(['main.mjs', 'preload.cjs', 'profile.mjs', 'security.mjs', 'api.mjs', 'storage.mjs',
  'adapters.mjs', 'runtime.mjs', 'protocol.mjs', 'lifetime.mjs', 'discovery.mjs', 'process.mjs', 'configuration.mjs']);
const errorCodes = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_UNSUPPORTED_ESM_URL_SCHEME', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ENOENT', 'EACCES', 'EPERM']);

export function mayRunMacDirectLaunchDiagnostic({ originalPids, missingPids, ownedStates, runningInstalledApplications }) {
  return Array.isArray(originalPids) && originalPids.length > 0
    && originalPids.every(pid => Number.isSafeInteger(pid) && pid > 1 && missingPids?.includes(pid))
    && Array.isArray(ownedStates) && ownedStates.every(state => state === 'gone')
    && runningInstalledApplications === 0;
}

export function isMacInstalledCleanupSafe({ ownedStates, directChild = null }) {
  return Array.isArray(ownedStates) && ownedStates.every(state => state === 'gone')
    && (directChild === null || directChild.closed === true);
}

export function classifyMacDirectLaunchOutput({ stdout = '', stderr = '', closed = false, code = null, signal = null }) {
  const text = `${typeof stderr === 'string' ? stderr.slice(-32_000) : ''}\n${typeof stdout === 'string' ? stdout.slice(-32_000) : ''}`;
  const errorCode = [...text.matchAll(/\b(?:ERR_[A-Z_]+|MODULE_NOT_FOUND|ENOENT|EACCES|EPERM)\b/g)]
    .map(match => match[0]).find(value => errorCodes.has(value)) ?? null;
  const file = [...text.matchAll(/(?:^|[/\\\s'"])([a-z][a-z-]*\.(?:mjs|cjs|js))(?=[:\s'"\)]|$)/g)]
    .map(match => match[1]).find(value => publicFiles.has(value)) ?? null;
  const reason = /Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|ERR_UNSUPPORTED_ESM_URL_SCHEME/i.test(text) ? 'module_missing'
    : /SyntaxError|ERR_MODULE_PARSE_FAILED/i.test(text) ? 'module_compile'
      : /ProcessSingleton|SingletonLock|single.instance lock/i.test(text) ? 'singleton'
        : /(?:fail(?:ed|ure)?|invalid|cannot|unable).{0,60}(?:user data directory|userData|profile)|(?:user data directory|userData|profile).{0,60}(?:fail(?:ed|ure)?|invalid|cannot|unable)/i.test(text) ? 'profile'
          : /code signature|CODESIGNING|invalid signature/i.test(text) ? 'code_signature'
            : /EACCES|EPERM|permission denied|operation not permitted/i.test(text) ? 'permission'
              : /Uncaught Exception|unhandled.{0,10}rejection|ERR_UNHANDLED_REJECTION/i.test(text) ? 'javascript'
                : errorCode === 'ENOENT' ? 'missing_file'
                  : closed ? (code === 0 && signal == null ? 'early_exit' : 'early_failure') : 'alive_unknown';
  return { reason, errorCode, file, exited: closed === true,
    exitCode: Number.isInteger(code) && code >= 0 && code <= 255 ? code : null,
    signal: signal == null ? null : selected(signal, signals),
    stdoutPresent: typeof stdout === 'string' && stdout.length > 0,
    stderrPresent: typeof stderr === 'string' && stderr.length > 0 };
}

export function classifyMacSignatureVerification({ code, stderr = '' }) {
  const exitCode = Number.isInteger(code) && code >= 0 && code <= 255 ? code : null;
  if (exitCode === 0) return { exitCode, valid: true, reason: 'valid' };
  const text = typeof stderr === 'string' ? stderr.slice(0, 32_000) : '';
  const reason = /invalid signature|code signature invalid|invalid code signature/i.test(text) ? 'signature_invalid'
    : /sealed resource|resource envelope|signed resource.*(?:added|modified|deleted)/i.test(text) ? 'resource_modified'
      : /not signed|no signature/i.test(text) ? 'unsigned'
        : /permission denied|operation not permitted/i.test(text) ? 'permission' : 'unknown';
  return { exitCode, valid: false, reason };
}

function selectReport({ pid, executable, appId, format, exception, signal, namespace, code }, ownership) {
  if (pid !== ownership.pid || appId !== ownership.appId || !samePath(executable, ownership.executable)) return null;
  const terminationNamespace = selected(namespace, namespaces);
  const exceptionType = selected(exception, exceptions);
  return {
    format,
    reason: terminationNamespace === 'CODESIGNING' ? 'code_signature'
      : terminationNamespace === 'DYLD' ? 'dynamic_loader'
        : ['WATCHDOG', 'JETSAM'].includes(terminationNamespace) || exceptionType === 'EXC_RESOURCE' ? 'resource_limit'
          : exceptionType !== 'UNKNOWN' || terminationNamespace === 'SIGNAL' ? 'native_exception' : 'unknown',
    exception: exceptionType, signal: selected(signal, signals), terminationNamespace,
    terminationCode: Number.isSafeInteger(code) && code >= 0 && code <= 0xffffffff ? code : null,
  };
}

export function selectOwnedMacCrashDiagnostic(text, ownership) {
  if (typeof text !== 'string' || text.length > maximumReportLength || !Number.isSafeInteger(ownership?.pid)
    || ownership.pid <= 1 || typeof ownership.appId !== 'string' || typeof ownership.executable !== 'string') return null;
  try {
    // Current .ips files contain a one-line JSON header followed by the JSON report.
    let value;
    try { value = JSON.parse(text); }
    catch {
      const separator = text.indexOf('\n');
      if (separator < 0) throw new Error('No report');
      JSON.parse(text.slice(0, separator));
      value = JSON.parse(text.slice(separator + 1));
    }
    if (value && typeof value === 'object') return selectReport({
      pid: value.pid, executable: value.procPath, appId: value.bundleInfo?.CFBundleIdentifier,
      format: 'ips', exception: value.exception?.type, signal: value.exception?.signal,
      namespace: value.termination?.namespace, code: value.termination?.code,
    }, ownership);
  } catch { /* Older .crash files use a bounded, line-based text format. */ }
  const pid = Number(/^Process:\s*[^\r\n]*\[(\d+)\]\s*$/m.exec(text)?.[1]);
  const executable = /^Path:\s*([^\r\n]+)$/m.exec(text)?.[1]?.trim();
  const appId = /^Identifier:\s*([^\r\n]+)$/m.exec(text)?.[1]?.trim();
  const exception = /^Exception Type:\s*(EXC_[A-Z_]+)(?:\s*\(([A-Z0-9]+)\))?/m.exec(text);
  const termination = /^Termination Reason:\s*Namespace\s+([A-Z]+),\s*Code\s+(\d+)/m.exec(text);
  return selectReport({ pid, executable, appId, format: 'crash', exception: exception?.[1], signal: exception?.[2],
    namespace: termination?.[1], code: termination ? Number(termination[2]) : null }, ownership);
}
