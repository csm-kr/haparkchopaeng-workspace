/** Installed DMG smoke for a disposable macOS runner; no product QA switches. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  run, until, reserveDebugPort, connectInstalledApp, fileHash, matchesInstalledRendererUrl,
  verifyInstalledCore, createOwnedDirectory, validateMacInstalledIdentity,
} from './installed-smoke-support.mjs';
import { assertMacPathInside, canonicalMacPath, classifyOwnedMacProcess, resolveMacProcessIdentity, sameMacPath } from './installed-macos-identity.mjs';
import { classifyMacDirectLaunchOutput, classifyMacSignatureVerification, classifyReportedMacMainState,
  isMacInstalledCleanupSafe, macDiagnosticEnvironment, mayRunMacDirectLaunchDiagnostic,
  selectOwnedMacCrashDiagnostic } from './installed-macos-diagnostics.mjs';

// NSWorkspace delivers an actual open-url AppleEvent, including on a cold launch.
// Supplying the URL only in --args would test argv rather than that OS boundary.
const workspaceHelper = String.raw`
import AppKit
import Foundation
import Darwin

func emit(_ value: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
        let text = String(data: data, encoding: .utf8) else { exit(2) }
  print(text)
  fflush(stdout)
}
func details(_ application: NSRunningApplication) -> [String: Any] {
  return ["pid": Int(application.processIdentifier),
          "path": application.bundleURL?.resolvingSymlinksInPath().path ?? "",
          "executable": application.executableURL?.resolvingSymlinksInPath().path ?? "",
          "started": application.launchDate?.timeIntervalSince1970 ?? 0,
          "terminated": application.isTerminated,
          "finishedLaunching": application.isFinishedLaunching]
}
let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count >= 2 else { exit(2) }
switch arguments[0] {
case "resolve":
  guard let url = URL(string: arguments[1]) else { exit(2) }
  if let application = NSWorkspace.shared.urlForApplication(toOpen: url) {
    emit(["path": application.resolvingSymlinksInPath().path])
  } else { emit(["path": NSNull()]) }
case "running":
  emit(["applications": NSRunningApplication.runningApplications(withBundleIdentifier: arguments[1]).map(details)])
case "identity":
  guard let pid = Int32(arguments[1]) else { exit(2) }
  if let application = NSRunningApplication(processIdentifier: pid) {
    emit(["application": details(application)])
  } else { emit(["application": NSNull()]) }
case "launch":
  guard arguments.count == 3, let url = URL(string: arguments[1]) else { exit(2) }
  let configuration = NSWorkspace.OpenConfiguration()
  configuration.activates = false
  configuration.arguments = [arguments[2]]
  var completed = false
  NSWorkspace.shared.open(url, configuration: configuration) { application, error in
    if let application = application {
      emit(["application": details(application)])
    } else {
      emit(["errorCode": (error as NSError?)?.code ?? -1])
    }
    completed = true
  }
  let deadline = Date(timeIntervalSinceNow: 25)
  while !completed && Date() < deadline {
    RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
  }
  if !completed { emit(["errorCode": -2]); exit(1) }
default:
  exit(2)
}
`;

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Only bounded public bundle identifiers/display names belong in diagnostics.
// Unexpected paths, URLs, control characters, or email-like values stay opaque.
function publicMetadata(value) {
  return typeof value === 'string' && /^[\p{L}\p{M}\p{N} ._()+&-]{1,200}$/u.test(value)
    ? value : { type: typeof value, length: typeof value === 'string' ? value.length : null, omitted: true };
}

export async function verifyMacInstallation({ configuration, context, qaRoot, evidence }) {
  assert.equal(process.platform, 'darwin', 'Installed DMG verification requires macOS.');
  assert.ok(['arm64', 'x64'].includes(process.arch), 'Unsupported native macOS architecture.');
  const { appId, productName, macBundleName, scheme, packageVersion, connectorRoot } = configuration;
  const runtimeProductName = configuration.runtimeProductName ?? productName;
  const profileName = configuration.stableProfileName ?? runtimeProductName;
  const macInternalName = configuration.macInternalName ?? productName;
  const macDisplayName = configuration.macDisplayName ?? productName;
  const profileRelativePath = configuration.profileRelativePath ?? [];
  assert.ok(Array.isArray(profileRelativePath));
  if (profileRelativePath.length) assert.deepEqual(profileRelativePath, [appId, 'production'],
    'Only the configured production profile may be inspected or removed.');
  assert.match(scheme, /^[a-z][a-z0-9+.-]*$/);
  assert.equal(basename(productName), productName, 'Product name must be one path segment.');
  assert.ok(typeof macBundleName === 'string' && macBundleName.trim() && basename(macBundleName) === macBundleName
    && !['.', '..'].includes(macBundleName), 'The configured macOS bundle filename is required.');
  await assertMacPathInside(qaRoot, context.runnerTemp);
  await assertMacPathInside(connectorRoot, context.workspace);
  evidence.checks ??= [];
  evidence.cleanup ??= {};
  evidence.limits = [...new Set([...(evidence.limits ?? []),
    'Local-build DMG copy and LaunchServices verification does not verify a browser download or Finder drag-and-drop.',
    'Developer ID signing, notarization, and quarantined-user Gatekeeper approval are not verified.',
    'Only invalid launch URIs are submitted; authenticated pairing, production API requests, and CLI execution are outside this smoke.',
    'API/CLI exclusion follows the parser-before-ack control flow; renderer CDP is not main-process network telemetry.',
  ])];
  const result = evidence.macos = { architecture: process.arch, mainPids: [], core: null,
    mode: 'production-packaged-invalid-uri', apiExclusion: 'parser-rejected-before-ack', mainProcessNetworkMeasured: false };
  const metadata = result.metadata = {
    configured: { appId: publicMetadata(appId), productName: publicMetadata(productName),
      runtimeProductName: publicMetadata(runtimeProductName), macInternalName: publicMetadata(macInternalName), macDisplayName: publicMetadata(macDisplayName),
      macBundleName: publicMetadata(macBundleName), packageVersion: publicMetadata(packageVersion), scheme: publicMetadata(scheme) },
    mount: {}, bundle: {},
    profile: { mode: profileRelativePath.length ? 'app-id-production' : configuration.stableProfileName ? 'stable-profile-name' : 'runtime-product-name',
      name: publicMetadata(profileName),
      relativePath: profileRelativePath.map(publicMetadata) },
  };
  const cleanup = evidence.cleanup.macos = { processesStopped: false, protocolUnregistered: false,
    applicationRemoved: false, profileRemoved: false, mountDetached: true, errors: [] };
  const coldUri = `${scheme}://wrong-host?attemptId=ci&launchToken=x`;
  const warmUri = `${scheme}://connect?extra=1`;
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  let helperDirectory, mountDirectory, mountPoint, installDirectory, installedApp, userData, resources, profileContainer, profileRoot;
  let installedExecutable, crashBaseline, diagnosticChildRecord = null, unexpectedNativeProfile, unexpectedDisplayProfile;
  const diagnosticDirectory = join(homedir(), 'Library', 'Logs', 'DiagnosticReports');
  let profileContainerAbsent = false;
  let mounted = false, registered = false, profileAbsent = false, swiftReady = false, connection, failure;
  const owned = new Map();
  const startedAt = Date.now();
  const checked = description => evidence.checks.push(description);
  const swift = async (...args) => JSON.parse((await run(join(helperDirectory.path, 'workspace'), args)).stdout.trim());
  const comparablePath = value => typeof value === 'string' ? resolve(value).normalize('NFC') : null;
  const handler = async () => {
    const value = (await swift('resolve', coldUri)).path;
    return typeof value === 'string' ? comparablePath(await canonicalMacPath(value)) : null;
  };
  const plist = async (file, key, format = 'raw') => (await run('/usr/bin/plutil', ['-extract', key, format, '-o', '-', file])).stdout.trim();
  const identityDiagnostics = metadata.processIdentity = { attempts: 0, rejected: {}, recent: [] };

  async function snapshotDiagnosticReports() {
    try {
      if (!(await exists(diagnosticDirectory))) return { available: false, reason: 'absent',
        capturedAt: Date.now(), names: new Set() };
      const stat = await lstat(diagnosticDirectory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { available: false, reason: 'not_regular_directory' };
      const directory = await canonicalMacPath(diagnosticDirectory);
      await assertMacPathInside(directory, join(homedir(), 'Library', 'Logs'));
      return { available: true, directory, capturedAt: Date.now(), names: new Set(await readdir(directory)) };
    } catch { return { available: false, reason: 'read_error' }; }
  }

  async function captureLaunchFailure() {
    const crash = metadata.launchFailure = {
      mainPids: result.mainPids.length, processes: [], profileCreated: false,
      directoryAvailable: crashBaseline?.available === true,
      directoryReason: crashBaseline?.available ? 'available' : (crashBaseline?.reason ?? 'not_observed'),
      scannedFiles: 0, skippedFiles: 0, readErrors: 0, reportsMatched: 0, reports: [],
      reportAbsenceDoesNotProveNormalExit: true,
    };
    for (const pid of result.mainPids.slice(-2)) {
      const application = (await swift('identity', String(pid))).application;
      let signalProbe = 'present';
      try { process.kill(pid, 0); } catch (error) { signalProbe = error.code === 'ESRCH' ? 'missing' : 'unavailable'; }
      crash.processes.push({ pid, applicationPresent: !!application,
        terminated: typeof application?.terminated === 'boolean' ? application.terminated : null,
        finishedLaunching: typeof application?.finishedLaunching === 'boolean' ? application.finishedLaunching : null,
        signalProbe });
    }
    if (userData) {
      crash.profileCreated = await exists(userData);
      crash.preferencesPresent = await exists(join(userData, 'preferences.json'));
      crash.deviceCredentialsPresent = await exists(join(userData, 'devices.enc.json'));
      if (unexpectedNativeProfile) crash.unexpectedNativeProfilePresent = await exists(unexpectedNativeProfile);
      if (unexpectedDisplayProfile) crash.unexpectedDisplayProfilePresent = await exists(unexpectedDisplayProfile);
    }
    if (!crashBaseline || (!crashBaseline.available && crashBaseline.reason !== 'absent')
      || !installedExecutable || result.mainPids.length === 0 || !(await exists(diagnosticDirectory))) return;
    const stat = await lstat(diagnosticDirectory);
    const currentDirectory = await canonicalMacPath(diagnosticDirectory);
    await assertMacPathInside(currentDirectory, join(homedir(), 'Library', 'Logs'));
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || (crashBaseline.available && !(await sameMacPath(currentDirectory, crashBaseline.directory)))) {
      crash.directoryReason = 'directory_changed'; return;
    }
    crash.directoryAvailable = true;
    crash.directoryReason = crashBaseline.available ? 'available' : 'created_after_launch';
    const names = (await readdir(currentDirectory))
      .filter(name => !crashBaseline.names.has(name) && /\.(?:ips|crash)$/.test(name));
    crash.scanLimited = names.length > 30;
    for (const name of names.slice(-30)) {
      try {
        const file = join(currentDirectory, name), entry = await lstat(file);
        if (!entry.isFile() || entry.isSymbolicLink() || entry.uid !== process.getuid()
          || entry.size > 2 * 1024 * 1024 || entry.mtimeMs < crashBaseline.capturedAt - 2_000) {
          crash.skippedFiles += 1; continue;
        }
        crash.scannedFiles += 1;
        const text = await readFile(file, 'utf8');
        for (const pid of result.mainPids.slice(-2)) {
          const report = selectOwnedMacCrashDiagnostic(text, { pid, appId, executable: installedExecutable });
          if (report) { crash.reportsMatched += 1; if (crash.reports.length < 3) crash.reports.push({ pid, ...report }); break; }
        }
      } catch { crash.readErrors += 1; }
    }
  }

  async function processIdentity(pid, { main = false } = {}) {
    // lstart is ASCII and independent of executable spelling. NSRunningApplication
    // supplies the main path; ps comm is only a strictly contained helper fallback.
    const response = await run('/bin/ps', ['-ww', '-p', String(pid), '-o', 'lstart='],
      { allowFailure: true, env: { LC_ALL: 'C' } });
    const application = (await swift('identity', String(pid))).application;
    const command = !main && !application?.executable
      ? await run('/bin/ps', ['-ww', '-p', String(pid), '-o', 'comm='], { allowFailure: true, env: { LC_ALL: 'en_US.UTF-8' } }) : null;
    const result = await resolveMacProcessIdentity({ pid, main, ownedBundle: installedApp,
      psExitCode: response.code || command?.code || 0, psStart: response.stdout,
      application, command: command?.stdout });
    identityDiagnostics.attempts += 1;
    if (result.reason) identityDiagnostics.rejected[result.reason] = (identityDiagnostics.rejected[result.reason] ?? 0) + 1;
    const sample = {
      main, reason: result.reason, psExitCode: response.code, psOutputPresent: !!response.stdout.trim(),
      applicationPresent: !!application, executableFromApplication: typeof application?.executable === 'string',
      commandFallbackUsed: !!command,
    };
    if (result.reason && !identityDiagnostics.firstRejection) identityDiagnostics.firstRejection = sample;
    identityDiagnostics.recent = [...identityDiagnostics.recent.slice(-7), sample];
    return result.identity;
  }
  async function ownedProcessState(identity) {
    // NSRunningApplication can unregister during quit before the kernel process
    // exits. Already admitted PIDs still require their exact executable and birth.
    const response = await run('/bin/ps', ['-ww', '-p', String(identity.pid), '-o', 'lstart='],
      { allowFailure: true, env: { LC_ALL: 'C' } });
    let missing = false, signalProbe = 'not-needed';
    if (response.code !== 0 || !response.stdout.trim()) {
      // Signal zero only probes existence; it never terminates an unknown PID.
      try { process.kill(identity.pid, 0); signalProbe = 'alive'; }
      catch (error) {
        missing = error.code === 'ESRCH';
        signalProbe = missing ? 'missing' : error.code === 'EPERM' ? 'denied' : 'failed';
      }
    }
    let current = null, executableObservationFailed = false;
    if (!missing && response.code === 0 && response.stdout.trim()) {
      try { current = await processIdentity(identity.pid); }
      catch { executableObservationFailed = true; }
    }
    const state = classifyOwnedMacProcess(identity, { current, missing, psExitCode: response.code, psStart: response.stdout });
    const liveness = metadata.processLiveness ??= { owned: 0, gone: 0, unresolved: 0, recent: [] };
    liveness[state] += 1;
    liveness.recent = [...liveness.recent.slice(-7), { state, psExitCode: response.code,
      psOutputPresent: !!response.stdout.trim(), signalProbe, executableObserved: !!current, executableObservationFailed }];
    return state;
  }
  async function captureProcesses(mainPid) {
    const main = await until(() => processIdentity(mainPid, { main: true }), 'installed main executable and ps start identity', 10_000);
    assert.ok(main, 'LaunchServices did not run the copied installed executable.');
    owned.set(mainPid, main);
    const rows = (await run('/bin/ps', ['-axo', 'pid=,ppid=,uid='])).stdout.trim().split('\n')
      .map(line => line.trim().split(/\s+/).map(Number)).filter(row => row.length === 3 && row.every(Number.isSafeInteger));
    const descendants = new Set([mainPid]);
    for (let changed = true; changed;) {
      changed = false;
      for (const [pid, parent, uid] of rows) if (uid === process.getuid() && descendants.has(parent) && !descendants.has(pid)) {
        descendants.add(pid); changed = true;
      }
    }
    for (const pid of descendants) {
      if (pid === mainPid) continue;
      const identity = await processIdentity(pid);
      if (identity) owned.set(pid, identity);
    }
  }
  async function observedStopStates() {
    const known = new Map(await Promise.all([...owned.values()].map(async identity =>
      [identity.pid, await ownedProcessState(identity)])));
    const reported = result.mainPids.map(pid => {
      let signalProbe = 'not_needed';
      if (!known.has(pid)) {
        signalProbe = 'present';
        try { process.kill(pid, 0); } catch (error) { signalProbe = error.code === 'ESRCH' ? 'missing' : 'unavailable'; }
      }
      return { pid, knownIdentity: known.has(pid), signalProbe,
        state: classifyReportedMacMainState({ knownState: known.get(pid), signalProbe }) };
    });
    metadata.reportedMainLiveness = { allGone: reported.every(value => value.state === 'gone'),
      checked: reported.length, recent: reported.slice(-6) };
    return { known, reported };
  }
  async function allStopped() {
    const { known, reported } = await observedStopStates();
    return isMacInstalledCleanupSafe({
      ownedStates: [...known.values()], reportedMainStates: reported.map(value => value.state),
      directChild: diagnosticChildRecord,
    });
  }
  async function directLaunchDiagnostic() {
    const diagnostic = metadata.directLaunch = { attempted: false, diagnosticOnly: true, originalOsFailurePreserved: true };
    if (!installedExecutable || !installedApp || !result.mainPids.length) { diagnostic.skipped = 'no_installed_launch'; return; }
    // Never overlap an unobservable or still-live OS launch. Known identity handles PID reuse;
    // without it, only ESRCH proves the reported OS PID is absent.
    await captureRemainingProcesses();
    const observation = await observedStopStates();
    const missingPids = observation.reported.filter(value => value.state === 'gone').map(value => value.pid);
    const running = (await swift('running', appId)).applications
      .filter(value => comparablePath(value.path) === comparablePath(installedApp));
    const ownedStates = [...observation.known.values()];
    if (!mayRunMacDirectLaunchDiagnostic({ originalPids: result.mainPids, missingPids, ownedStates,
      runningInstalledApplications: running.length })) { diagnostic.skipped = 'prior_processes_not_proven_gone'; return; }
    const port = await reserveDebugPort();
    const child = spawn(installedExecutable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', coldUri],
      { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: macDiagnosticEnvironment(process.env) });
    const record = diagnosticChildRecord = { stdout: '', stderr: '', closed: false, code: null, signal: null };
    child.stdout.on('data', value => { record.stdout = (record.stdout + value.toString()).slice(-32_000); });
    child.stderr.on('data', value => { record.stderr = (record.stderr + value.toString()).slice(-32_000); });
    child.once('error', () => { diagnostic.spawnFailed = true; });
    child.once('close', (code, signal) => { record.closed = true; record.code = code; record.signal = signal; });
    diagnostic.attempted = true; diagnostic.cdpConnected = false; diagnostic.sameParserErrorObserved = false;
    diagnostic.officialElectronConsoleDiagnostics = true;
    diagnostic.cleanupSignalsSent = 0;
    let client;
    try {
      if (Number.isSafeInteger(child.pid) && child.pid > 1) {
        diagnostic.pid = child.pid;
        let targetReady = false;
        try {
          await until(async () => {
            if (record.closed) return true;
            const identity = await processIdentity(child.pid, { main: true }) ?? await processIdentity(child.pid);
            if (!identity) return false;
            owned.set(child.pid, identity); diagnostic.ownedIdentityObserved = true;
            try {
              const listener = await run('/usr/sbin/lsof', ['-nP', '-a', '-p', String(child.pid), `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'],
                { allowFailure: true, timeout: 2000 });
              const fields = listener.stdout.trim().split('\n');
              const addresses = fields.filter(field => field.startsWith('n')).map(field => field.slice(1));
              if (!fields.includes(`p${child.pid}`) || !addresses.length
                || !addresses.every(value => value === `127.0.0.1:${port}` || value === `[::1]:${port}`)) return false;
              const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(600) });
              if (!response.ok) return false;
              const targets = await response.json();
              targetReady = Array.isArray(targets) && targets.some(value => value.type === 'page'
                && matchesInstalledRendererUrl(value.url, join(resources, 'app.asar', 'renderer', 'index.html')));
              return targetReady;
            } catch { return false; }
          }, 'bounded direct diagnostic startup', 5000);
        } catch { diagnostic.startupObservationTimedOut = true; }
        if (targetReady && !record.closed) {
          client = await connectInstalledApp(port, join(resources, 'app.asar', 'renderer', 'index.html'));
          diagnostic.cdpConnected = true;
          const current = await client.state();
          diagnostic.sameParserErrorObserved = current.stage === 'error'
            && current.description === '등록된 앱의 연결 링크를 사용해 주세요.'
            && current.attemptId === null && current.providers.length === 0;
        }
      }
    } catch { diagnostic.observationFailed = true; }
    finally {
      // Snapshot before our shutdown so SIGTERM/SIGKILL are not misreported as an early application failure.
      diagnostic.initialOutcome = classifyMacDirectLaunchOutput(record);
      if (client) {
        diagnostic.normalQuitRequested = true;
        try { await client.quit(); } catch { diagnostic.normalQuitError = true; }
        client.close();
        try { await until(() => record.closed, 'direct diagnostic IPC exit', 3000); } catch {}
      }
      try {
        await captureRemainingProcesses();
        for (const signal of ['SIGTERM', 'SIGKILL']) {
          if (record.closed && await allStopped()) break;
          for (const identity of [...owned.values()].reverse()) if (await ownedProcessState(identity) === 'owned') {
            process.kill(identity.pid, signal); diagnostic.cleanupSignalsSent += 1;
          }
          try { await until(async () => record.closed && await allStopped(), 'owned direct diagnostic cleanup', 3000); break; } catch {}
        }
        diagnostic.ownedProcessesStopped = record.closed && await allStopped();
      } catch { diagnostic.cleanupObservationFailed = true; }
      diagnostic.finalOutcome = classifyMacDirectLaunchOutput(record);
      if (!record.closed) { child.unref(); child.stdout.unref?.(); child.stderr.unref?.(); }
    }
  }
  async function captureRemainingProcesses() {
    if (!installedApp || !(await exists(installedApp))) return;
    // Helpers may be reparented after a main-process crash. Read executable names,
    // never arbitrary process arguments, and accept only this unique owned bundle.
    const processes = await run('/bin/ps', ['-ww', '-U', String(process.getuid()), '-o', 'pid=', '-o', 'comm='], { env: { LC_ALL: 'en_US.UTF-8' } });
    const prefix = `${comparablePath(installedApp)}/`;
    for (const line of processes.stdout.trim().split('\n')) {
      const match = /^(\d+)\s+(.+)$/.exec(line.trim());
      if (!match || !match[2].startsWith('/')) continue;
      const executable = await canonicalMacPath(match[2]).catch(() => null);
      if (!executable || !comparablePath(executable)?.startsWith(prefix)) continue;
      const pid = Number(match[1]);
      const identity = await processIdentity(pid, { main: owned.get(pid)?.main === true });
      if (identity) owned.set(identity.pid, identity);
    }
  }
  async function quitNormally() {
    assert.ok(connection, 'Installed app CDP connection is unavailable.');
    // The normal IPC may close its CDP socket before its promise reply arrives.
    await connection.quit().catch(() => {});
    await connection.close(); connection = null;
    await until(allStopped, 'installed macOS app normal IPC exit', 15_000);
  }
  async function errorState(description) {
    const state = await until(async () => {
      const current = await connection.state();
      return current.stage === 'error' && current.description === description ? current : false;
    }, 'installed macOS app rejected invalid URI');
    assert.equal(state.attemptId, null);
    assert.deepEqual(state.providers, []);
    assert.equal(state.autoStart, false); assert.equal(state.pet, false);
    assert.equal(await exists(join(userData, 'devices.enc.json')), false, 'Invalid URI reached credential persistence.');
    assert.equal(await exists(join(userData, 'preferences.json')), false, 'Invalid cold URI opened the first-run web flow.');
    assert.equal(await exists(userData), true, 'The original runtime credential profile was not created.');
    metadata.profile.runtimeProfileCreated = true;
    if (unexpectedNativeProfile) {
      assert.equal(await exists(unexpectedNativeProfile), false, 'Native bundle naming must not move the credential profile.');
      metadata.profile.internalNameProfileCreated = false;
    }
    if (unexpectedDisplayProfile) {
      assert.equal(await exists(unexpectedDisplayProfile), false, 'Display branding must not move the credential profile.');
      metadata.profile.displayNameProfileCreated = false;
    }
  }

  try {
    evidence.phase = 'macos_preflight';
    await lstat(lsregister);
    helperDirectory = await createOwnedDirectory(qaRoot, 'mac-workspace-');
    await writeFile(join(helperDirectory.path, 'workspace.swift'), workspaceHelper, { flag: 'wx' });
    evidence.phase = 'macos_compile_workspace_helper';
    await run('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', join(helperDirectory.path, 'module-cache'),
      join(helperDirectory.path, 'workspace.swift'), '-o', join(helperDirectory.path, 'workspace')], { timeout: 90_000 });
    swiftReady = true; evidence.phase = 'macos_preflight';
    assert.deepEqual((await swift('running', appId)).applications, [], 'An existing app with this bundle ID is running.');
    assert.equal(await handler(), null, 'A protocol handler already exists; refusing to replace it.');
    for (const parent of ['/Applications', join(homedir(), 'Applications')]) {
      assert.equal(await exists(join(parent, `${macBundleName}.app`)), false, 'An existing installation must be preserved.');
    }
    const dist = join(connectorRoot, 'dist');
    await assertMacPathInside(dist, connectorRoot);
    const suffix = `-${packageVersion}-mac-${process.arch}.dmg`;
    const images = (await readdir(dist)).filter(name => name.endsWith(suffix));
    assert.equal(images.length, 1, 'Expected exactly one DMG for this package version and native architecture.');
    const image = join(dist, images[0]);
    const imageStat = await lstat(image);
    assert.ok(imageStat.isFile() && !imageStat.isSymbolicLink(), 'DMG must be a regular, non-symlink file.');
    await assertMacPathInside(image, dist);
    result.dmg = { filename: basename(image), sha256: await fileHash(image), bytes: imageStat.size };

    evidence.phase = 'macos_dmg_mount_directory';
    mountDirectory = await createOwnedDirectory(qaRoot, 'mac-volume-');
    // Leave the directory's ownership marker outside the actual empty mountpoint.
    mountPoint = join(mountDirectory.path, 'volume'); await mkdir(mountPoint);
    mountPoint = await canonicalMacPath(mountPoint);
    // Record attachment ownership even if a later plist check fails.
    mounted = true; cleanup.mountDetached = false;
    evidence.phase = 'macos_dmg_attach';
    const attachment = await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen',
      '-mountpoint', mountPoint, '-plist', image]);
    metadata.mount.attachExitCode = attachment.code;
    metadata.mount.plistReturned = attachment.stdout.trim().length > 0;
    evidence.phase = 'macos_mount_plist';
    const attachmentFile = join(helperDirectory.path, 'attachment.plist');
    await writeFile(attachmentFile, attachment.stdout, { flag: 'wx' });
    const entities = JSON.parse(await plist(attachmentFile, 'system-entities', 'json'));
    metadata.mount.entitiesAreArray = Array.isArray(entities);
    metadata.mount.entityCount = Array.isArray(entities) ? entities.length : null;
    assert.ok(Array.isArray(entities), 'Mounted device entities must be an array.');
    const canonicalMatches = await Promise.all(entities.map(async entry => typeof entry?.['mount-point'] === 'string'
      && await sameMacPath(entry['mount-point'], mountPoint).catch(() => false)));
    metadata.mount.entities = entities.slice(0, 16).map((entry, index) => ({
      hasMountPoint: typeof entry?.['mount-point'] === 'string',
      mountPointMatched: entry?.['mount-point'] === mountPoint,
      normalizedMountPointMatched: typeof entry?.['mount-point'] === 'string'
        && comparablePath(entry['mount-point']) === comparablePath(mountPoint),
      canonicalMountPointMatched: canonicalMatches[index],
      devEntryValid: /^\/dev\/disk\d+(?:s\d+)*$/.test(entry?.['dev-entry'] ?? ''),
    }));
    const volumes = entities.filter((_entry, index) => canonicalMatches[index]);
    assert.equal(volumes.length, 1, 'Exactly one owned mountpoint must match the attached image.');
    const volume = volumes[0];
    metadata.mount.mountPointMatched = !!volume;
    metadata.mount.devEntryValid = !!volume && /^\/dev\/disk\d+(?:s\d+)*$/.test(volume['dev-entry']);
    evidence.phase = 'macos_mount_device_assert';
    assert.ok(volume && /^\/dev\/disk\d+(?:s\d+)*$/.test(volume['dev-entry']), 'Unexpected mounted DMG device.');
    evidence.phase = 'macos_dmg_app_names';
    const appNames = (await readdir(mountPoint)).filter(name => name.endsWith('.app'));
    metadata.mount.appNameCount = appNames.length;
    metadata.mount.appNames = appNames.slice(0, 10).map(publicMetadata);
    metadata.mount.appNamesAscii = appNames.slice(0, 10).map(name => /^[\x20-\x7e]+$/.test(name));
    metadata.mount.configuredAppName = publicMetadata(`${macBundleName}.app`);
    metadata.mount.appNamesNormalized = appNames.slice(0, 10).map(name => publicMetadata(name.normalize('NFC')));
    assert.deepEqual(appNames.map(name => name.normalize('NFC')), [`${macBundleName}.app`.normalize('NFC')],
      'DMG app name differs from the configured product.');
    evidence.phase = 'macos_dmg_app_directory';
    const sourceApp = join(mountPoint, appNames[0]);
    const sourceAppStat = await lstat(sourceApp);
    metadata.mount.appIsDirectory = sourceAppStat.isDirectory();
    metadata.mount.appIsSymlink = sourceAppStat.isSymbolicLink();
    assert.ok(sourceAppStat.isDirectory(), 'DMG app is not a real directory.');
    await assertMacPathInside(sourceApp, mountPoint);
    const info = join(sourceApp, 'Contents', 'Info.plist');
    evidence.phase = 'macos_bundle_identifier';
    const observedAppId = await plist(info, 'CFBundleIdentifier');
    metadata.bundle.appId = publicMetadata(observedAppId);
    assert.equal(observedAppId, appId);
    evidence.phase = 'macos_bundle_version';
    const observedVersion = await plist(info, 'CFBundleShortVersionString');
    metadata.bundle.packageVersion = publicMetadata(observedVersion);
    assert.equal(observedVersion, packageVersion);
    evidence.phase = 'macos_bundle_schemes';
    const schemes = JSON.parse(await plist(info, 'CFBundleURLTypes', 'json')).flatMap(value => value.CFBundleURLSchemes ?? []);
    metadata.bundle.schemeCount = schemes.length;
    metadata.bundle.schemes = schemes.slice(0, 10).map(publicMetadata);
    assert.deepEqual(schemes, [scheme], 'Installed bundle must advertise only its configured URI scheme.');
    evidence.phase = 'macos_bundle_name';
    const bundleName = await plist(info, 'CFBundleName');
    metadata.bundle.bundleName = publicMetadata(bundleName);
    assert.ok(bundleName && basename(bundleName) === bundleName, 'Invalid app profile directory name.');
    assert.equal(bundleName.normalize('NFC'), macInternalName.normalize('NFC'), 'Native bundle name differs from the configured Helper identity.');
    const displayName = await plist(info, 'CFBundleDisplayName');
    metadata.bundle.displayName = publicMetadata(displayName);
    assert.equal(displayName.normalize('NFC'), macDisplayName.normalize('NFC'), 'Bundle display name differs from the configured display brand.');
    evidence.phase = 'macos_profile_path';
    const profileParent = await canonicalMacPath(join(homedir(), 'Library', 'Application Support'));
    profileRoot = profileParent;
    userData = profileRelativePath.length ? join(profileParent, ...profileRelativePath) : join(profileParent, profileName);
    await assertMacPathInside(userData, profileParent, { allowMissing: true });
    metadata.profile.insideAppData = true;
    if (profileRelativePath.length) {
      evidence.phase = 'macos_profile_parent';
      profileContainer = join(profileParent, appId);
      profileContainerAbsent = !(await exists(profileContainer));
      metadata.profile.parentExists = !profileContainerAbsent;
      if (!profileContainerAbsent) {
        const parentStat = await lstat(profileContainer);
        metadata.profile.parentIsDirectory = parentStat.isDirectory();
        metadata.profile.parentIsSymlink = parentStat.isSymbolicLink();
        assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink(), 'Production profile parent must be a real directory.');
        await assertMacPathInside(profileContainer, profileParent);
        metadata.profile.parentRealpathMatched = await sameMacPath(profileContainer, await realpath(profileContainer));
        assert.equal(metadata.profile.parentRealpathMatched, true);
      }
    }
    evidence.phase = 'macos_profile_absence';
    const profileExists = await exists(userData);
    metadata.profile.exists = profileExists;
    assert.equal(profileExists, false, 'An existing production profile must be preserved.');
    profileAbsent = true;
    if (!profileRelativePath.length && macInternalName.normalize('NFC') !== profileName.normalize('NFC')) {
      unexpectedNativeProfile = join(profileParent, macInternalName);
      await assertMacPathInside(unexpectedNativeProfile, profileParent, { allowMissing: true });
      assert.equal(await exists(unexpectedNativeProfile), false, 'An existing alternate native-name profile must be preserved.');
      metadata.profile.internalNameProfileInitiallyAbsent = true;
    }
    if (!profileRelativePath.length && runtimeProductName.normalize('NFC') !== profileName.normalize('NFC')) {
      unexpectedDisplayProfile = join(profileParent, runtimeProductName);
      await assertMacPathInside(unexpectedDisplayProfile, profileParent, { allowMissing: true });
      assert.equal(await exists(unexpectedDisplayProfile), false, 'An existing display-name profile must be preserved.');
      metadata.profile.displayNameProfileInitiallyAbsent = true;
    }

    evidence.phase = 'macos_copy';
    installDirectory = await createOwnedDirectory('/Applications', 'connector-ci-mac-');
    installedApp = join(installDirectory.path, `${macBundleName}.app`);
    await assertMacPathInside(installedApp, installDirectory.path, { allowMissing: true });
    const sourceAsarPath = join(sourceApp, 'Contents', 'Resources', 'app.asar');
    const asarStat = await lstat(sourceAsarPath);
    assert.ok(asarStat.isFile() && !asarStat.isSymbolicLink(), 'DMG app.asar must be a regular file.');
    const sourceAsar = await fileHash(sourceAsarPath);
    await run('/usr/bin/ditto', [sourceApp, installedApp], { timeout: 90_000 });
    installedApp = await realpath(installedApp);
    resources = join(installedApp, 'Contents', 'Resources');
    assert.equal(await fileHash(join(resources, 'app.asar')), sourceAsar, 'DMG copy altered app.asar.');
    result.core = await verifyInstalledCore(resources, join(connectorRoot, 'core'));
    const executableName = await plist(join(installedApp, 'Contents', 'Info.plist'), 'CFBundleExecutable');
    assert.equal(basename(executableName), executableName, 'Invalid bundle executable name.');
    const executable = join(installedApp, 'Contents', 'MacOS', executableName);
    installedExecutable = executable;
    assert.ok((await lstat(executable)).isFile(), 'Installed executable is missing.');
    await assertMacPathInside(executable, installedApp);
    evidence.phase = 'macos_installed_runtime_and_helper_identity';
    const requireDesktop = createRequire(pathToFileURL(join(connectorRoot, 'desktop', 'package.json')));
    const asar = await import(pathToFileURL(requireDesktop.resolve('@electron/asar')).href);
    const packagedMetadata = asar.extractFile(join(resources, 'app.asar'), 'package.json');
    assert.ok(packagedMetadata.length > 0 && packagedMetadata.length <= 1024 * 1024);
    const runtimeMetadata = JSON.parse(packagedMetadata.toString('utf8'));
    assert.equal(runtimeMetadata.name, configuration.runtimePackageName, 'Packaged runtime application identity changed.');
    assert.equal(runtimeMetadata.version, packageVersion, 'Packaged runtime version differs from its installed bundle.');
    assert.equal(runtimeMetadata.stableProfileName, configuration.stableProfileName, 'Packaged credential profile identity changed.');
    metadata.bundle.runtimePackageName = publicMetadata(runtimeMetadata.name);
    metadata.bundle.runtimeProductName = publicMetadata(runtimeMetadata.productName);
    if (runtimeMetadata.stableProfileName) metadata.bundle.stableProfileName = publicMetadata(runtimeMetadata.stableProfileName);
    const helpers = [];
    for (const parent of [join(installedApp, 'Contents', 'Frameworks'), join(installedApp, 'Contents', 'Library', 'LoginItems')]) {
      if (!(await exists(parent))) continue;
      await assertMacPathInside(parent, installedApp);
      for (const bundle of (await readdir(parent)).filter(name => name.endsWith('.app'))) {
        const helper = join(parent, bundle), stat = await lstat(helper);
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'A Helper must be a real owned bundle.');
        await assertMacPathInside(helper, installedApp);
        const helperExecutable = await plist(join(helper, 'Contents', 'Info.plist'), 'CFBundleExecutable');
        assert.equal(basename(helperExecutable), helperExecutable);
        const helperFile = join(helper, 'Contents', 'MacOS', helperExecutable), fileStat = await lstat(helperFile);
        assert.ok(fileStat.isFile() && !fileStat.isSymbolicLink());
        await assertMacPathInside(helperFile, helper);
        helpers.push({ bundleName: bundle, executableName: helperExecutable });
      }
    }
    metadata.bundle.nativeIdentity = validateMacInstalledIdentity(configuration, {
      internalName: bundleName, displayName, executableName, runtimeProductName: runtimeMetadata.productName, helpers,
    });
    metadata.bundle.helpers = helpers.map(helper => ({ bundleName: publicMetadata(helper.bundleName), executableName: publicMetadata(helper.executableName) }));
    const bundledNode = JSON.parse((await run(executable, ['-e', 'process.stdout.write(JSON.stringify({node:process.versions.node,arch:process.arch}))'], { env: { ELECTRON_RUN_AS_NODE: '1' } })).stdout);
    assert.equal(bundledNode.arch, process.arch); assert.ok(Number(bundledNode.node.split('.')[0]) >= 22);
    result.bundledNode = bundledNode;
    checked('Copied macOS app supplies its own Node runtime without an external Node installation.');
    await run('/usr/bin/hdiutil', ['detach', mountPoint]);
    mounted = false; cleanup.mountDetached = true;
    checked('Native-architecture DMG mounted read-only, copied to an owned Applications directory, and installed core SHA-256 matched.');

    // Assessment is evidence, not a substitute for Developer ID signing/notarization.
    evidence.phase = 'macos_distribution_assessment';
    const signature = await run('/usr/bin/codesign', ['-dv', '--verbose=2', installedApp], { allowFailure: true });
    const signatureVerification = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', installedApp], { allowFailure: true });
    const gatekeeper = await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', installedApp], { allowFailure: true });
    const quarantine = await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', installedApp], { allowFailure: true });
    result.distribution = { signatureExitCode: signature.code,
      developerId: /Authority=Developer ID Application:/.test(signature.stderr),
      adHoc: /Signature=adhoc/.test(signature.stderr), gatekeeperAccepted: gatekeeper.code === 0,
      gatekeeperExitCode: gatekeeper.code, quarantinePresent: quarantine.code === 0,
      quarantineModified: false, notarizationVerified: false,
      strictVerification: classifyMacSignatureVerification(signatureVerification) };
    // A broken bundle seal makes Gatekeeper call a downloaded copy damaged, with no Open Anyway path.
    assert.equal(result.distribution.strictVerification.valid, true, 'The installed bundle signature does not pass strict verification.');
    checked('Installed bundle passed strict deep code signature verification.');

    evidence.phase = 'macos_protocol_registration';
    registered = true; // Cleanup also unregisters a partially successful registration.
    await run(lsregister, ['-f', installedApp]);
    assert.equal(await handler(), comparablePath(installedApp), 'LaunchServices did not select the installed copied app.');
    checked('LaunchServices URI resolution selected the copied Applications bundle.');

    // The hosted runner is fresh. Preserve a before-launch baseline, never publish reports themselves.
    crashBaseline = await snapshotDiagnosticReports();

    const renderer = join(resources, 'app.asar', 'renderer', 'index.html');
    for (let sequence = 1; sequence <= 2; sequence += 1) {
      evidence.phase = sequence === 1 ? 'macos_cold_uri_launch' : 'macos_restarted_cold_uri_launch';
      assert.deepEqual((await swift('running', appId)).applications, [], 'The prior app process is still running.');
      const port = await reserveDebugPort();
      const launched = (await swift('launch', coldUri, `--remote-debugging-port=${port}`)).application;
      assert.ok(launched && Number.isSafeInteger(launched.pid) && launched.pid > 1, 'LaunchServices could not launch the installed app.');
      assert.equal(await sameMacPath(launched.path, installedApp), true, 'A source or translocated bundle was launched.');
      await assertMacPathInside(launched.executable, installedApp);
      result.mainPids.push(launched.pid);
      (metadata.launchCallbacks ??= []).push({ pid: launched.pid,
        terminated: typeof launched.terminated === 'boolean' ? launched.terminated : null,
        finishedLaunching: typeof launched.finishedLaunching === 'boolean' ? launched.finishedLaunching : null });
      await captureProcesses(launched.pid);
      evidence.phase = sequence === 1 ? 'macos_cold_cdp_attach' : 'macos_restarted_cdp_attach';
      await until(async () => {
        const listener = await run('/usr/sbin/lsof', ['-nP', '-a', '-p', String(launched.pid),
          `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'], { allowFailure: true });
        const fields = listener.stdout.trim().split('\n');
        const addresses = fields.filter(field => field.startsWith('n')).map(field => field.slice(1));
        return fields.includes(`p${launched.pid}`) && addresses.length > 0
          && addresses.every(address => address === `127.0.0.1:${port}` || address === `[::1]:${port}`);
      }, 'installed main PID owns only a loopback CDP listener', 30_000);
      const targetDiagnostic = {};
      (metadata.rendererTargets ??= []).push(targetDiagnostic);
      connection = await connectInstalledApp(port, renderer, { diagnostics: targetDiagnostic });
      evidence.phase = sequence === 1 ? 'macos_cold_uri_rejection' : 'macos_restarted_uri_rejection';
      await errorState('등록된 앱의 연결 링크를 사용해 주세요.');
      const current = (await swift('identity', String(launched.pid))).application;
      assert.ok(current && comparablePath(current.path) === comparablePath(launched.path) && current.started === launched.started,
        'The installed cold-start process changed identity.');
      checked(sequence === 1 ? 'Installed cold URI launch rejected invalid host before credentials/API/CLI.'
        : 'Installed app restarted after normal IPC exit and rejected another cold URI.');

      if (sequence === 1) {
        evidence.phase = 'macos_warm_uri';
        // No -a: this exercises the registered default URI handler on a live app.
        await run('/usr/bin/open', ['-g', warmUri]);
        await errorState('연결 링크에 허용되지 않은 정보가 있어요.');
        const running = (await swift('running', appId)).applications;
        assert.equal(running.length, 1);
        assert.equal(running[0].pid, launched.pid);
        assert.equal(comparablePath(running[0].path), comparablePath(launched.path));
        assert.equal(running[0].started, launched.started);
        await captureProcesses(launched.pid);
        checked('Default-handler warm URI delivery changed the parser error in the same installed app PID.');
      }
      evidence.phase = 'macos_normal_quit';
      await captureProcesses(launched.pid);
      await quitNormally();
      checked('Installed macOS app and captured helpers exited through normal connector quit IPC.');
    }
  } catch (error) {
    failure = error;
    result.failureIdentity = { attempts: identityDiagnostics.attempts, rejected: { ...identityDiagnostics.rejected },
      recent: identityDiagnostics.recent.map(sample => ({ ...sample })) };
    try { if (swiftReady) await captureLaunchFailure(); }
    catch { metadata.launchFailureObservationFailed = true; }
    try { if (swiftReady && /macos_(?:cold_uri_launch|cold_cdp_attach|restarted_cold_uri_launch|restarted_cdp_attach)$/.test(evidence.phase)) await directLaunchDiagnostic(); }
    catch { metadata.directLaunchObservationFailed = true; }
  }
  finally {
    cleanup.directChildExitObserved = diagnosticChildRecord === null || diagnosticChildRecord.closed === true;
    cleanup.reportedMainExitObserved = result.mainPids.length === 0;
    if (!cleanup.directChildExitObserved) cleanup.removalDeferred = 'direct_child_exit_unconfirmed';
    else if (!cleanup.reportedMainExitObserved) cleanup.removalDeferred = 'reported_main_exit_unconfirmed';
    async function clean(label, action) {
      try { await action(); }
      catch { cleanup.errors.push(label); }
    }
    await clean('owned-process-stop', async () => {
      // LaunchServices can start the app even if its launch callback later times out.
      // Recover only this unique copied path, never another app sharing the bundle ID.
      if (swiftReady && installedApp && await exists(installedApp)) {
        const installedPath = await realpath(installedApp);
        for (const application of (await swift('running', appId)).applications) {
          if (comparablePath(application.path) === comparablePath(installedPath)) {
            if (!result.mainPids.includes(application.pid)) result.mainPids.push(application.pid);
            await captureProcesses(application.pid);
          }
        }
      }
      if (connection) { await connection.quit().catch(() => {}); await connection.close(); connection = null; }
      await captureRemainingProcesses();
      if (!(await allStopped())) {
        for (const signal of ['SIGTERM', 'SIGKILL']) {
          for (const identity of [...owned.values()].reverse()) if (await ownedProcessState(identity) === 'owned') {
            process.kill(identity.pid, signal);
          }
          try { await until(allStopped, 'owned installed macOS process cleanup', 5_000); break; } catch {}
        }
      }
      const stopped = await allStopped();
      cleanup.directChildExitObserved = diagnosticChildRecord === null || diagnosticChildRecord.closed === true;
      cleanup.reportedMainExitObserved = metadata.reportedMainLiveness?.allGone === true;
      if (!cleanup.directChildExitObserved) cleanup.removalDeferred = 'direct_child_exit_unconfirmed';
      else if (!cleanup.reportedMainExitObserved) cleanup.removalDeferred = 'reported_main_exit_unconfirmed';
      else if (!stopped) cleanup.removalDeferred = 'owned_process_exit_unconfirmed';
      else delete cleanup.removalDeferred;
      assert.ok(stopped, 'An owned installed process, reported main PID or unconfirmed direct child remains.');
      cleanup.processesStopped = true;
    });
    if (cleanup.processesStopped && registered) await clean('protocol-unregister', async () => {
      await run(lsregister, ['-u', installedApp]); cleanup.protocolUnregistered = true;
    });
    if (cleanup.processesStopped && installDirectory && (!registered || cleanup.protocolUnregistered)) await clean('application-remove', async () => {
      await installDirectory.cleanup(); cleanup.applicationRemoved = !(await exists(installDirectory.path));
      assert.ok(cleanup.applicationRemoved);
      if (registered) await until(async () => (await handler()) === null, 'absent URI handler baseline restored');
    });
    if (cleanup.processesStopped && profileAbsent && userData && result.mainPids.length > 0) await clean('profile-remove', async () => {
      assert.equal(comparablePath(await canonicalMacPath(profileRoot)), comparablePath(profileRoot), 'The captured app-data root changed.');
      if (await exists(userData)) {
        const stat = await lstat(userData);
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
          && stat.birthtimeMs >= startedAt - 2_000, 'The app profile is not a newly owned directory.');
        await assertMacPathInside(userData, profileRoot);
        await rm(userData, { recursive: true });
      }
      cleanup.profileRemoved = !(await exists(userData));
      // The common kit creates an app-ID parent. Remove it only if it was absent
      // before this run and is now empty; a pre-existing development profile stays.
      if (profileContainerAbsent && profileContainer && await exists(profileContainer)) {
        const parentStat = await lstat(profileContainer);
        assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink() && parentStat.uid === process.getuid()
          && parentStat.birthtimeMs >= startedAt - 2_000, 'App profile parent is not newly owned.');
        await assertMacPathInside(profileContainer, profileRoot);
        await rmdir(profileContainer);
      }
    });
    if (mounted) await clean('volume-detach', async () => {
      await run('/usr/bin/hdiutil', ['detach', mountPoint]); mounted = false; cleanup.mountDetached = true;
    });
    if (unexpectedNativeProfile && await exists(unexpectedNativeProfile)) {
      cleanup.unexpectedNativeProfileRetained = true;
      cleanup.errors.push('unexpected-native-profile-created');
    }
    if (unexpectedDisplayProfile && await exists(unexpectedDisplayProfile)) {
      cleanup.unexpectedDisplayProfileRetained = true;
      cleanup.errors.push('unexpected-display-profile-created');
    }
    if (mountDirectory && !mounted) await clean('mount-directory-remove', () => mountDirectory.cleanup());
    // Keep the temporary helper/plist on failure; it contains no credentials.
    if (!failure && !cleanup.errors.length && helperDirectory) await clean('helper-remove', () => helperDirectory.cleanup());
  }
  if (failure) throw failure;
  assert.deepEqual(cleanup.errors, [], 'Installed macOS cleanup did not fully complete.');
  assert.ok(cleanup.processesStopped && cleanup.protocolUnregistered && cleanup.applicationRemoved
    && cleanup.profileRemoved && cleanup.mountDetached, 'Installed macOS cleanup evidence is incomplete.');
  checked('Installed macOS bundle, owned profile, mount, processes, and URI registration were removed.');
  evidence.phase = 'macos_installation_verified';
}
