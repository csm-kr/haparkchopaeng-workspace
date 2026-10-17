/** CI-only installed Windows URI smoke. It never installs, registers, or uninstalls an app. */
import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  connectInstalledApp, diagnostic, loadConfiguration, reserveDebugPort, run, start, until, verifyInstalledCore,
} from './installed-smoke-support.mjs';
import {
  assertWindowsRunner, windowsSmokeLayout, assertOwnedWindowsInstallation, parseWindowsSmokeArguments,
  assertWindowsProcessIdentity, sameWindowsProcess, selectWindowsMain, assertWindowsRejectedState,
  classifyWindowsKnownProcess,
  windowsNativeFailure,
  windowsProcessObservation,
  windowsProfileObservation,
  windowsControlledUriObservation,
  assertFreshWindowsProfile, assertWindowsProtocolCommand, windowsSmokeUris, windowsInside, sameWindowsPath,
  WINDOWS_COLD_ERROR, WINDOWS_WARM_ERROR,
} from './installed-windows-support.mjs';

const connectorRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Every argument is JSON, encoded as data. PowerShell is never given an interpolated shell command.
// Process argv is returned only after its installed path and current-user SID have matched.
export const WINDOWS_NATIVE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ConnectorInstalledWindowsNative {
  [DllImport("shell32.dll", SetLastError=true)] static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string command, out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  public static string[] Split(string command) {
    int count; IntPtr pointer = CommandLineToArgvW(command, out count);
    if (pointer == IntPtr.Zero) throw new InvalidOperationException("ARGV_UNAVAILABLE");
    try {
      var result = new string[count];
      for (int index=0; index<count; index++) result[index] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer, index*IntPtr.Size));
      return result;
    } finally { LocalFree(pointer); }
  }
}
'@
function Write-QaJson($qaValue) { $qaValue | ConvertTo-Json -Depth 8 -Compress }
function Get-QaSid($qaProcess) {
  $qaOwner = Invoke-CimMethod -InputObject $qaProcess -MethodName GetOwnerSid
  if ($qaOwner.ReturnValue -ne 0) { throw 'OWNER_UNAVAILABLE' }
  return [string]$qaOwner.Sid
}
function Get-QaExpectedProcess {
  $qaExpected = $qaInput.identity
  $qaCandidate = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + [int]$qaExpected.pid)
  if (-not $qaCandidate -or -not $qaCandidate.ExecutablePath) { return $null }
  $qaAliases = @($qaExpected.executable, $qaExpected.nativeExecutable) | Where-Object { $_ }
  $qaMatchesPath = @($qaAliases | Where-Object { [string]::Equals([IO.Path]::GetFullPath($_), [IO.Path]::GetFullPath($qaCandidate.ExecutablePath), [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
  if (-not $qaMatchesPath -or $qaCandidate.CreationDate.ToUniversalTime().ToString('o') -ne $qaExpected.createdAt -or (Get-QaSid $qaCandidate) -ne $qaExpected.sid) { return $null }
  return $qaCandidate
}
switch ($qaInput.operation) {
  'context' {
    Write-QaJson @{ sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; appData = [Environment]::GetFolderPath('ApplicationData') }
  }
  'protocol' {
    $qaKey = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey(([string]$qaInput.scheme + '\shell\open\command'))
    try { Write-QaJson @{ command = $(if ($qaKey) { $qaKey.GetValue('') } else { $null }) } }
    finally { if ($qaKey) { $qaKey.Dispose() } }
  }
  'path' {
    $qaPathStage = 'exists'
    try {
      if (-not (Test-Path -LiteralPath $qaInput.path)) { Write-QaJson @{ exists = $false }; break }
      $qaPathStage = 'item'
      $qaItem = Get-Item -LiteralPath $qaInput.path -Force
      $qaPathStage = 'acl'
      $qaDescriptor = Get-Acl -LiteralPath $qaInput.path
      $qaPathStage = 'owner_sid'
      $qaOwnerSid = $qaDescriptor.GetOwner([Security.Principal.SecurityIdentifier]).Value
      if ($qaOwnerSid -notmatch '^S-\d+(?:-\d+)+$') { throw (New-Object InvalidOperationException('OWNER_SID_UNAVAILABLE')) }
      $qaPathStage = 'response'
      Write-QaJson @{ exists = $true; sid = $qaOwnerSid; reparsePoint = [bool]($qaItem.Attributes -band [IO.FileAttributes]::ReparsePoint) }
    } catch {
      $qaException = $_.Exception
      for ($qaDepth = 0; $qaDepth -lt 4 -and $qaException.InnerException; $qaDepth++) { $qaException = $qaException.InnerException }
      $qaExceptionType = $qaException.GetType().Name
      $qaAllowedExceptionTypes = @('UnauthorizedAccessException', 'SecurityException', 'IdentityNotMappedException', 'ArgumentException', 'ArgumentNullException', 'ItemNotFoundException', 'InvalidOperationException', 'IOException', 'Win32Exception', 'MethodInvocationException', 'ParameterBindingException', 'CommandNotFoundException', 'RuntimeException', 'PathTooLongException')
      if ($qaAllowedExceptionTypes -notcontains $qaExceptionType) { $qaExceptionType = 'UNKNOWN' }
      Write-QaJson @{ nativeDiagnostic = @{ pathStage = $qaPathStage; exceptionType = $qaExceptionType } }
      exit 1
    }
  }
  'processes' {
    $qaSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $qaPrefixes = @($qaInput.installation, $qaInput.installationAlias) | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' }
    $qaRows = @()
    $qaPathRows = 0; $qaOtherUserRows = 0
    foreach ($qaItem in @(Get-CimInstance -ClassName Win32_Process)) {
      if (-not $qaItem.ExecutablePath) { continue }
      $qaPath = [IO.Path]::GetFullPath($qaItem.ExecutablePath)
      if (@($qaPrefixes | Where-Object { $qaPath.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -eq 0) { continue }
      $qaPathRows++
      if ((Get-QaSid $qaItem) -ne $qaSid) { $qaOtherUserRows++; continue }
      $qaRows += @{ pid = [int]$qaItem.ProcessId; executable = $qaPath; sid = $qaSid;
        createdAt = $qaItem.CreationDate.ToUniversalTime().ToString('o'); argv = @([ConnectorInstalledWindowsNative]::Split($qaItem.CommandLine)) }
    }
    Write-QaJson @{ processes = $qaRows; counts = @{ installedPathRows = $qaPathRows; otherUserRows = $qaOtherUserRows } }
  }
  'identity' {
    $qaCandidate = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + [int]$qaInput.identity.pid)
    if (-not $qaCandidate) { Write-QaJson @{ exists = $false }; break }
    $qaCreatedAt = $qaCandidate.CreationDate.ToUniversalTime().ToString('o')
    if ($qaCreatedAt -ne $qaInput.identity.createdAt) { Write-QaJson @{ exists = $true; createdAt = $qaCreatedAt }; break }
    $qaOwnerSid = $null
    if ($qaCandidate.ExecutablePath) { try { $qaOwnerSid = Get-QaSid $qaCandidate } catch {} }
    Write-QaJson @{ exists = $true; pid = [int]$qaCandidate.ProcessId; createdAt = $qaCreatedAt; executable = $qaCandidate.ExecutablePath; sid = $qaOwnerSid }
  }
  'open' {
    $qaStart = New-Object Diagnostics.ProcessStartInfo
    $qaStart.FileName = [string]$qaInput.uri; $qaStart.UseShellExecute = $true; $qaStart.Verb = 'open'
    $qaStart.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $qaOpened = [Diagnostics.Process]::Start($qaStart)
    if ($qaOpened) { $qaOpened.Dispose() }
    Write-QaJson @{ requested = $true }
  }
  'window' {
    $qaCandidate = Get-QaExpectedProcess
    if (-not $qaCandidate) { Write-QaJson @{ matched = $false; visible = $false }; break }
    $qaProcess = [Diagnostics.Process]::GetProcessById([int]$qaCandidate.ProcessId)
    try {
      $qaHandle = $qaProcess.MainWindowHandle
      [uint32]$qaWindowPid = 0
      [void][ConnectorInstalledWindowsNative]::GetWindowThreadProcessId($qaHandle, [ref]$qaWindowPid)
      Write-QaJson @{ matched = $true; visible = [bool]($qaHandle -ne [IntPtr]::Zero -and $qaWindowPid -eq $qaCandidate.ProcessId -and [ConnectorInstalledWindowsNative]::IsWindowVisible($qaHandle)) }
    } finally { $qaProcess.Dispose() }
  }
  'close' {
    $qaCandidate = Get-QaExpectedProcess
    if (-not $qaCandidate) { Write-QaJson @{ matched = $false; requested = $false }; break }
    $qaProcess = [Diagnostics.Process]::GetProcessById([int]$qaCandidate.ProcessId)
    try { Write-QaJson @{ matched = $true; requested = [bool]$qaProcess.CloseMainWindow() } }
    finally { $qaProcess.Dispose() }
  }
  'kill' {
    $qaCandidate = Get-QaExpectedProcess
    if (-not $qaCandidate) { Write-QaJson @{ matched = $false; requested = $false }; break }
    $qaProcess = [Diagnostics.Process]::GetProcessById([int]$qaCandidate.ProcessId)
    try {
      # Hold the process handle before checking again; never terminate a name or process tree.
      $qaHeldHandle = $qaProcess.Handle
      if (-not (Get-QaExpectedProcess)) { Write-QaJson @{ matched = $false; requested = $false }; break }
      $qaProcess.Kill(); Write-QaJson @{ matched = $true; requested = $true }
    } finally { $qaProcess.Dispose() }
  }
  'listeners' {
    Write-QaJson @{ listeners = @(Get-NetTCPConnection -State Listen -LocalPort ([int]$qaInput.port) -ErrorAction SilentlyContinue | ForEach-Object { @{ pid = [int]$_.OwningProcess; address = [string]$_.LocalAddress } }) }
  }
  default { throw 'UNKNOWN_OPERATION' }
}
`;

export async function invokeWindowsNative(operation, input = {}, { execute = run, environment = process.env } = {}) {
  const encodedInput = Buffer.from(JSON.stringify({ ...input, operation })).toString('base64');
  const command = `$qaInput = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedInput}')) | ConvertFrom-Json\n${WINDOWS_NATIVE_SCRIPT}`;
  // A pwsh -> Node -> WinPS child must rebuild its own compatible module paths.
  // Undefined is omitted by execFile; preserve every other inherited variable.
  const env = Object.fromEntries(Object.keys(environment).filter(key => key.toUpperCase() === 'PSMODULEPATH').map(key => [key, undefined]));
  let result;
  try { result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { timeout: 15_000, env }); }
  catch (error) {
    throw Object.assign(new Error('Windows native observation failed'), { code: 'WINDOWS_NATIVE_FAILED',
      nativeFailure: windowsNativeFailure(error, operation) });
  }
  try { return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); }
  catch {
    throw Object.assign(new Error('Windows native observation did not return JSON'), { code: 'WINDOWS_NATIVE_INVALID_JSON',
      nativeFailure: { ...windowsNativeFailure({ result }, operation), stderrCategory: 'NATIVE_INVALID_JSON' } });
  }
}
const native = invokeWindowsNative;

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function describePath(file) {
  let info;
  try { info = await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return { path: file, exists: false }; throw error; }
  const owner = await native('path', { path: file });
  assert.ok(owner.exists, 'Profile changed while inspecting ownership');
  return { path: file, exists: true, directory: info.isDirectory(), reparsePoint: info.isSymbolicLink() || owner.reparsePoint,
    realPath: await realpath(file), sid: owner.sid, createdAt: info.birthtime.toISOString() };
}

async function loadLayout(configuration) {
  const desktop = join(connectorRoot, 'desktop');
  const [pkg, runtime] = await Promise.all(['package.json', 'apps.generated.json'].map(async name => JSON.parse(await readFile(join(desktop, name), 'utf8'))));
  const build = pkg.build?.appId ? pkg.build : JSON.parse(await readFile(join(desktop, 'builder.generated.json'), 'utf8'));
  return windowsSmokeLayout(configuration, { applicationId: runtime.applications[0].id, executableName: build.win?.executableName ?? build.executableName });
}

async function observeWindowsInstallation(options, evidence) {
  const workspace = await realpath(dirname(connectorRoot));
  const context = assertWindowsRunner(process.env, { platform: process.platform, workspace });
  assert.ok(!process.env.ELECTRON_RUN_AS_NODE && !process.env.ELECTRON_DISABLE_SANDBOX, 'Packaged runtime/sandbox overrides are forbidden');
  evidence.phase = 'windows_configuration';
  const configuration = await loadConfiguration(connectorRoot), layout = await loadLayout(configuration);
  const runtime = JSON.parse(await readFile(join(connectorRoot, 'desktop', 'apps.generated.json'), 'utf8'));
  evidence.allowedSites = runtime.applications[0].allowedOrigins.map(value => {
    const url = new URL(value); assert.equal(url.protocol, 'https:'); assert.equal(url.href, `${url.origin}/`); return url.origin;
  });
  const temporaryRoot = await realpath(tmpdir());
  assertWindowsRunner({ ...process.env, RUNNER_TEMP: temporaryRoot }, { platform: process.platform, workspace: context.workspace });
  const directory = await realpath(options.installation);
  const installation = assertOwnedWindowsInstallation(directory, temporaryRoot, layout.installationPrefix);
  assert.ok((await lstat(options.installation)).isDirectory() && !(await lstat(options.installation)).isSymbolicLink());
  const executable = join(installation, layout.executableFilename);
  const system = await native('context');
  assert.match(system.sid, /^S-1-5-21-\d+-\d+-\d+-\d+$/);
  const appData = await realpath(system.appData), profile = windowsInside(join(appData, ...layout.profileRelativePath), appData);
  const parent = dirname(profile), parentBefore = await describePath(parent);
  if (parentBefore.exists) assert.ok(parentBefore.directory && !parentBefore.reparsePoint && sameWindowsPath(parentBefore.realPath, parent));
  const before = await describePath(profile);
  assert.equal(before.exists, false, 'An existing production profile must be preserved');
  evidence.checks.push('windows_existing_production_profile_refused');
  evidence.phase = options.preflight ? 'windows_before_install' : 'windows_installed_preflight';
  const protocol = (await native('protocol', { scheme: layout.scheme })).command;
  if (options.preflight) {
    assert.equal(protocol, null, 'An existing URI handler must be preserved');
    assert.equal(await exists(executable), false, 'An existing installed executable must be preserved');
  } else {
    assert.ok((await lstat(executable)).isFile() && !(await lstat(executable)).isSymbolicLink());
    const match = /^"([^"\r\n]+)" "%1"$/.exec(protocol ?? '');
    assert.ok(match && sameWindowsPath(await realpath(match[1]), await realpath(executable)));
    assertWindowsProtocolCommand(protocol, match[1]);
  }
  evidence.processObservation = { samples: 0, maxInstalledPathRows: 0, maxOtherUserRows: 0, maxCurrentUserRows: 0, maxMainRows: 0, maxExactUriRows: 0, knownOwnedIdentities: 0 };
  const processes = async () => {
    const observation = await native('processes', { installation, installationAlias: options.installation });
    const rows = await Promise.all(observation.processes.map(async row => ({ ...row, nativeExecutable: row.executable, executable: await realpath(row.executable) })));
    const summary = windowsProcessObservation({ ...observation, processes: rows }, { executable, uri: windowsSmokeUris(layout).cold });
    const uriObservation = windowsControlledUriObservation(rows, { executable, uri: windowsSmokeUris(layout).cold });
    if (uriObservation.mainArgCount > 0) evidence.cold.uriArgumentObservation = uriObservation;
    evidence.processObservation.samples++;
    evidence.processObservation.latest = summary;
    for (const key of ['installedPathRows', 'otherUserRows', 'currentUserRows', 'mainRows', 'exactUriRows']) {
      const maximum = `max${key[0].toUpperCase()}${key.slice(1)}`;
      evidence.processObservation[maximum] = Math.max(evidence.processObservation[maximum], summary[key]);
    }
    return rows;
  };
  assert.deepEqual(await processes(), [], 'Existing installed processes must be preserved');
  if (options.preflight) {
    evidence.checks.push('windows_before_install_profile_handler_and_process_guards');
    return;
  }

  const resources = join(installation, 'resources');
  evidence.installedCoreCount = (await verifyInstalledCore(resources, join(connectorRoot, 'core'))).count;
  evidence.checks.push('windows_installed_shipping_core_hashes');
  const startedAt = Date.now(), uris = windowsSmokeUris(layout), owned = new Map();
  let client, launched, failure;
  const ownership = { installation, executable, sid: system.sid, notBefore: startedAt };
  const remember = row => {
    const identity = { ...assertWindowsProcessIdentity(row, { ...ownership, executable: undefined }), nativeExecutable: row.nativeExecutable };
    owned.set(identity.pid, identity); evidence.processObservation.knownOwnedIdentities = owned.size; return identity;
  };
  const capture = async () => { const rows = await processes(); rows.forEach(remember); return rows; };
  const allOwnedStopped = async () => {
    const rows = await capture();
    const states = await Promise.all([...owned.values()].map(async identity => {
      const observation = await native('identity', { identity });
      if (observation.executable) observation.executable = await realpath(observation.executable).catch(() => null);
      return classifyWindowsKnownProcess(observation, identity);
    }));
    return rows.length === 0 && states.every(state => state === 'gone');
  };
  const noInvalidFiles = async () => {
    assert.equal(await exists(join(profile, 'devices.enc.json')), false, 'Invalid URI created credentials');
    assert.equal(await exists(join(profile, 'preferences.json')), false, 'Invalid URI started first-run web flow');
  };
  try {
    evidence.phase = 'windows_cold_shell_execute';
    assert.equal((await native('open', { uri: uris.cold })).requested, true); evidence.cold.shellExecuteRequested = true;
    const cold = await until(async () => {
      const rows = await capture();
      const identity = selectWindowsMain(rows, { ...ownership, uri: uris.cold });
      if (!identity) return false;
      return owned.get(identity.pid);
    }, 'the OS cold URI in one installed main process', 30_000);
    const coldArguments = evidence.cold.uriArgumentObservation;
    evidence.cold.installedPidObserved = true;
    evidence.cold.exactUriArgumentObserved = coldArguments.rawExactMatch === true;
    evidence.cold.normalizedRootSlashObserved = coldArguments.exactControlledUriWithSlash === true;
    evidence.cold.controlledUriArgumentObserved = evidence.cold.exactUriArgumentObserved || evidence.cold.normalizedRootSlashObserved;
    assert.equal(evidence.cold.controlledUriArgumentObserved, true);
    evidence.phase = 'windows_cold_visible_window';
    await until(async () => { const window = await native('window', { identity: cold }); return window.matched && window.visible; }, 'the installed cold application window', 30_000);
    evidence.cold.visibleWindowObserved = true;
    await noInvalidFiles();
    evidence.phase = 'windows_cold_normal_close';
    const close = await native('close', { identity: cold }); assert.ok(close.matched && close.requested);
    await until(allOwnedStopped, 'the installed cold window and helpers to exit', 20_000);
    evidence.cold.normalWindowCloseObserved = true;
    evidence.checks.push('windows_os_cold_uri_installed_pid_argument_window_and_normal_close');

    evidence.phase = 'windows_packaged_cdp';
    const port = await reserveDebugPort();
    launched = start(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', uris.cold]);
    const warm = await until(async () => {
      const rows = await capture(); const identity = selectWindowsMain(rows, { ...ownership, uri: uris.cold });
      return identity?.pid === launched.pid ? owned.get(identity.pid) : false;
    }, 'the exact directly launched installed main', 30_000);
    await until(async () => {
      const rows = (await native('listeners', { port })).listeners;
      return rows.length > 0 && rows.every(row => row.pid === warm.pid && ['127.0.0.1', '::1'].includes(row.address));
    }, 'the installed main owns only a loopback CDP listener', 30_000);
    client = await connectInstalledApp(port, join(resources, 'app.asar', 'renderer', 'index.html'));
    await until(async () => { const state = await client.state(); return state.stage === 'error' && state.description === WINDOWS_COLD_ERROR; }, 'the packaged initial parser rejection');
    assertWindowsRejectedState(await client.state(), WINDOWS_COLD_ERROR);
    evidence.warm.initialParserErrorObserved = true;
    evidence.phase = 'windows_warm_shell_execute';
    assert.equal((await native('open', { uri: uris.warm })).requested, true); evidence.warm.shellExecuteRequested = true;
    await until(async () => { const state = await client.state(); return state.stage === 'error' && state.description === WINDOWS_WARM_ERROR; }, 'the OS warm URI changes the existing installed state');
    assertWindowsRejectedState(await client.state(), WINDOWS_WARM_ERROR);
    const rows = await capture(), current = selectWindowsMain(rows, ownership);
    assert.ok(current && sameWindowsProcess(current, warm));
    await noInvalidFiles();
    evidence.warm.distinctParserErrorObserved = true; evidence.warm.sameMainPidObserved = true; evidence.warm.singleMainObserved = true;
    evidence.checks.push('windows_os_warm_uri_same_installed_main_and_distinct_parser_error');
    evidence.phase = 'windows_normal_ipc_quit';
    await client.quit(); client.close(); client = null;
    await until(() => launched.closed, 'the installed application normal IPC exit', 20_000);
    assert.deepEqual(await launched.done, { code: 0, signal: null });
    await until(allOwnedStopped, 'all installed application helpers to exit', 20_000);
    evidence.normalQuitObserved = true;
  } catch (error) { failure = error; }
  finally {
    client?.close();
    try {
      const remaining = await capture();
      for (const row of remaining) {
        const identity = owned.get(row.pid);
        if (identity && sameWindowsProcess(row, identity)) await native('kill', { identity });
      }
      await until(allOwnedStopped, 'owned installed process cleanup', 15_000);
      evidence.cleanup.ownedProcessesStopped = true;
    } catch (error) {
      evidence.cleanup.errors.push('owned_process_stop'); evidence.cleanup.deferred = true;
      evidence.cleanup.failureCode = diagnostic(error, 'windows_cleanup').code;
      if (error.nativeFailure) evidence.cleanup.nativeFailure = error.nativeFailure;
    }
    if (evidence.cleanup.ownedProcessesStopped) {
      try {
        evidence.cleanup.profileTarget = 'profile';
        const descriptor = await describePath(profile);
        evidence.cleanup.profileObservation = windowsProfileObservation(descriptor, { profile, sid: system.sid, notBefore: startedAt });
        assertFreshWindowsProfile(descriptor, { appData, profile, sid: system.sid, notBefore: startedAt, existedBefore: before.exists });
        if (descriptor.exists) {
          assert.ok(owned.size > 0, 'Profile ownership was not observed through an installed process');
          windowsInside(profile, appData);
          await rm(profile, { recursive: true });
        }
        evidence.cleanup.freshProfileRemoved = !(await exists(profile));
        if (!parentBefore.exists && !sameWindowsPath(parent, appData) && await exists(parent)) {
          evidence.cleanup.profileTarget = 'parent';
          const descriptor = await describePath(parent);
          evidence.cleanup.profileObservation = windowsProfileObservation(descriptor, { profile: parent, sid: system.sid, notBefore: startedAt });
          assertFreshWindowsProfile(descriptor, { appData, profile: parent, sid: system.sid, notBefore: startedAt, existedBefore: false });
          await rmdir(parent); // Empty only; preserve an independently created development profile.
        }
      } catch (error) {
        evidence.cleanup.errors.push('fresh_profile_remove');
        evidence.cleanup.profileFailureCode = diagnostic(error, 'windows_profile_cleanup').code;
        if (error.nativeFailure) evidence.cleanup.nativeFailure = error.nativeFailure;
      }
    }
  }
  if (failure) throw failure;
  assert.deepEqual(evidence.cleanup.errors, []);
  assert.ok(evidence.cleanup.ownedProcessesStopped && evidence.cleanup.freshProfileRemoved);
  evidence.checks.push('windows_normal_ipc_exit_owned_processes_and_fresh_profile_cleanup');
}

export async function main(argv = process.argv.slice(2)) {
  let authorized = false;
  const evidence = { passed: false, mode: 'production-installed-windows-invalid-uri', phase: 'windows_runner_guard',
    source: /^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA : undefined, allowedSites: [], checks: [], actualInferenceRequests: 0,
    cold: { shellExecuteRequested: false, installedPidObserved: false, exactUriArgumentObserved: false, controlledUriArgumentObserved: false, normalizedRootSlashObserved: false, visibleWindowObserved: false, rendererStateObserved: false, normalWindowCloseObserved: false },
    warm: { initialParserErrorObserved: false, shellExecuteRequested: false, distinctParserErrorObserved: false, sameMainPidObserved: false, singleMainObserved: false },
    normalQuitObserved: false, cleanup: { ownedProcessesStopped: false, freshProfileRemoved: false, errors: [] },
    limits: ['Cold renderer state is not observed; cold proof is OS dispatch, installed PID/argv and visible window.',
      'Only invalid synthetic URIs are used; pairing, API ACK, credential encryption and AI inference are not tested.',
      'API/CLI exclusion follows the shipping parser-before-identity/ACK control flow; main-process network traffic is not independently measured.',
      'Unsigned local CI installer; browser download, SmartScreen, publisher signing, reboot and update approval are not tested.'] };
  try {
    assertWindowsRunner(process.env, { platform: process.platform, workspace: await realpath(dirname(connectorRoot)) });
    authorized = true;
    const options = parseWindowsSmokeArguments(argv);
    evidence.preflightOnly = options.preflight;
    await observeWindowsInstallation(options, evidence);
    evidence.passed = true; evidence.phase = options.preflight ? 'windows_preflight_completed' : 'windows_installed_uri_completed';
  } catch (error) {
    process.exitCode = 1; evidence.error = diagnostic(error, evidence.phase);
    if (error.nativeFailure) evidence.nativeFailure = error.nativeFailure;
  }
  finally {
    try {
      if (authorized) {
        const artifacts = join(connectorRoot, 'artifacts'); await mkdir(artifacts, { recursive: true });
        await writeFile(join(artifacts, 'windows-installed-uri-qa.json'), JSON.stringify(evidence, null, 2) + '\n');
      }
    } catch { process.exitCode = 1; evidence.passed = false; evidence.cleanup.errors.push('evidence_write'); }
    console.log(JSON.stringify(evidence));
  }
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
