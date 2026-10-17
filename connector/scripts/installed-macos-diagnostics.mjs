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

export function classifyReportedMacMainState({ knownState, signalProbe }) {
  if (['gone', 'owned', 'unresolved'].includes(knownState)) return knownState;
  return signalProbe === 'missing' ? 'gone' : 'unresolved';
}

export function isMacInstalledCleanupSafe({ ownedStates, directChild = null, reportedMainStates = [] }) {
  return Array.isArray(ownedStates) && ownedStates.every(state => state === 'gone')
    && Array.isArray(reportedMainStates) && reportedMainStates.every(state => state === 'gone')
    && (directChild === null || directChild.closed === true);
}

export function macDiagnosticEnvironment(environment) {
  return { ...environment, ELECTRON_ENABLE_LOGGING: 'true', ELECTRON_ENABLE_STACK_DUMPING: 'true' };
}

function fatalCategoriesFromText(value) {
  const text = typeof value === 'string' ? value.slice(0, 64_001) : '';
  return [
    ['profile', /\bprofile(?:s|_dir|_path)?\b/i],
    ['user_data', /\buser[_ -]?data(?:[_ -]?(?:dir|directory))?\b/i],
    ['path_append', /\b(?:FilePath::)?Append(?:ASCII|RelativePath)?\b|IsPathAbsolute|IsAbsolute\(/],
    ['check_failed', /\bCheck failed\b|\bD?CHECK(?:_[A-Z]+)?\s*(?:failed|failure|\()/i],
    ['oom', /\bout of memory\b|\bOOM\b|allocation failed|heap limit/i],
    ['dyld', /\bdyld\b|library not loaded|symbol not found/i],
    ['code_signature', /code sign(?:ature|ing)|CODESIGNING/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function nativeFatalSiteFromText(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!/\bFATAL\b|\bAssertion failed\b|\bCheck failed\b/i.test(line)) continue;
    const site = /(?:^|[^A-Za-z0-9_.-])(async_wrap\.(?:cc|h)|node\.cc|node_bindings\.cc|node_main_instance\.cc|electron_browser_main_parts\.cc|electron_main_delegate\.cc|electron_api_app\.cc|file_path\.cc|logging\.cc)(?:\(([1-9]\d{0,5})\)|:([1-9]\d{0,5})(?=[:\s)\].,]|$)|,\s*line\s+([1-9]\d{0,5})(?=[\s.)\],]|$))/.exec(line);
    if (site) return { file: site[1], line: Number(site[2] ?? site[3] ?? site[4]) };
  }
  return null;
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
  return { reason, errorCode, file, fatalCategories: fatalCategoriesFromText(text), nativeFatalSite: nativeFatalSiteFromText(text), exited: closed === true,
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

const systemImagePaths = new Set([
  ...['libsystem_kernel.dylib', 'libsystem_c.dylib', 'libsystem_pthread.dylib', 'libsystem_platform.dylib',
    'libsystem_malloc.dylib', 'libdispatch.dylib', 'libdyld.dylib'].map(name => `/usr/lib/system/${name}`),
  '/usr/lib/dyld', '/usr/lib/libc++abi.dylib', '/usr/lib/libc++.1.dylib', '/usr/lib/libobjc.A.dylib',
  ...['CoreFoundation', 'Foundation', 'AppKit'].map(name => `/System/Library/Frameworks/${name}.framework/Versions/A/${name}`),
]);
const systemSymbols = new Set(['__pthread_kill', '_pthread_kill', 'pthread_kill', '_pthread_start', 'pthread_start',
  'thread_start', 'start_wqthread', 'start', '_start', 'abort', '_abort', '__abort_with_payload',
  '__psynch_cvwait', '__psynch_mutexwait', '__ulock_wait', 'mach_msg2_trap', 'mach_msg2_internal',
  'mach_msg_overwrite', 'mach_msg', '__CFRunLoopRun', '__CFRunLoopServiceMachPort', 'CFRunLoopRunSpecific',
  'CFRunLoopRun', 'CFRunLoopRunInMode', 'NSApplicationMain', 'ElectronMain', 'ChromeMain']);

function publicNativeFacts(value, ownership) {
  const facts = {}, images = Array.isArray(value.usedImages) ? value.usedImages : [];
  const threads = Array.isArray(value.threads) ? value.threads : [];
  const faulting = Number.isInteger(value.faultingThread) && value.faultingThread >= 0
    && value.faultingThread < threads.length;
  const thread = faulting ? threads[value.faultingThread] : threads.find(entry => entry?.triggered === true);
  if (thread) {
    facts.nativeFrameSource = faulting ? 'faulting_thread' : 'triggered_thread';
    facts.nativeFrames = [];
    const bundle = ownership.executable.replace(/\/Contents\/MacOS\/[^/]+$/, '').normalize('NFC');
    const electronPrefix = `${bundle}/Contents/Frameworks/Electron Framework.framework/Versions/`;
    for (const frame of (Array.isArray(thread.frames) ? thread.frames : []).slice(0, 128)) {
      const imagePath = Number.isInteger(frame?.imageIndex) && frame.imageIndex >= 0
        ? images[frame.imageIndex]?.path : null;
      if (typeof imagePath !== 'string' || imagePath.length > 8192) continue;
      const normalized = imagePath.normalize('NFC');
      const image = normalized.startsWith(electronPrefix)
        && /^(?:[A-Z]|Current)\/Electron Framework$/.test(normalized.slice(electronPrefix.length)) ? 'electron_framework'
        : systemImagePaths.has(normalized) ? 'system_library' : null;
      if (!image || typeof frame.symbol !== 'string' || frame.symbol.length > 4096) continue;
      // Argument lists can contain arbitrary text. Preserve only a public qualified function identifier.
      const symbol = frame.symbol.split('(', 1)[0];
      if (symbol.length > 180 || (!systemSymbols.has(symbol)
        && !/^(?:electron|base|content|node|v8|crashpad|logging|dyld4)::[A-Za-z_~][A-Za-z0-9_~]*(?:::[A-Za-z_~][A-Za-z0-9_~]*)*$/.test(symbol))) continue;
      if (!facts.nativeFrames.some(entry => entry.image === image && entry.symbol === symbol)) facts.nativeFrames.push({ image, symbol });
      if (facts.nativeFrames.length === 8) break;
    }
  }
  let fatalText = '';
  const appendText = (entry, depth = 0) => {
    if (fatalText.length >= 8192 || depth > 4) return;
    if (typeof entry === 'string') fatalText += `\n${entry.slice(0, 8192 - fatalText.length)}`;
    else if (entry && typeof entry === 'object') Object.values(entry).slice(0, 16).forEach(part => appendText(part, depth + 1));
  };
  appendText(value.asi); appendText(value.termination?.details);
  appendText(value.termination?.indicator); appendText(value.termination?.reasons);
  const categories = fatalCategoriesFromText(fatalText);
  if (categories.length) facts.fatalCategories = categories;
  return facts;
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
    if (value && typeof value === 'object') {
      const report = selectReport({
        pid: value.pid, executable: value.procPath, appId: value.bundleInfo?.CFBundleIdentifier,
        format: 'ips', exception: value.exception?.type, signal: value.exception?.signal,
        namespace: value.termination?.namespace, code: value.termination?.code,
      }, ownership);
      return report ? { ...report, ...publicNativeFacts(value, ownership) } : null;
    }
  } catch { /* Older .crash files use a bounded, line-based text format. */ }
  const pid = Number(/^Process:\s*[^\r\n]*\[(\d+)\]\s*$/m.exec(text)?.[1]);
  const executable = /^Path:\s*([^\r\n]+)$/m.exec(text)?.[1]?.trim();
  const appId = /^Identifier:\s*([^\r\n]+)$/m.exec(text)?.[1]?.trim();
  const exception = /^Exception Type:\s*(EXC_[A-Z_]+)(?:\s*\(([A-Z0-9]+)\))?/m.exec(text);
  const termination = /^Termination Reason:\s*Namespace\s+([A-Z]+),\s*Code\s+(\d+)/m.exec(text);
  return selectReport({ pid, executable, appId, format: 'crash', exception: exception?.[1], signal: exception?.[2],
    namespace: termination?.[1], code: termination ? Number(termination[2]) : null }, ownership);
}
