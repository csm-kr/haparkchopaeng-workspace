import assert from 'node:assert/strict';
import { lstat, readFile, readdir, readlink, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, relative } from 'node:path';
import {
  assertInside, connectInstalledApp, createOwnedDirectory, fileHash, getInstalledBrowserProcesses,
  reserveDebugPort, run, start, until, verifyInstalledCore,
} from './installed-smoke-support.mjs';
import { createLinuxProcessTracker, inspectInstalledProcessTree, inspectLinuxCommandLine, readLinuxProcessStat,
  observeSyntheticUri, verifyLinuxCdpRenderers } from './linux-process-observation.mjs';

const processTracker = createLinuxProcessTracker();

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function loadedAppArmorProfile(name) {
  const profiles = '/sys/kernel/security/apparmor/profiles';
  const available = await run('sudo', ['-n', 'test', '-f', profiles], { allowFailure: true });
  if (available.code === 1) return null;
  assert.equal(available.code, 0, 'Cannot inspect the kernel AppArmor profile registry');
  const result = await run('sudo', ['-n', 'cat', profiles]);
  return result.stdout.split('\n').some(line => line.startsWith(`${name} (`));
}

// Read argv only after matching this user's exact installed executable directory.
async function installedProcess(pid, installation) {
  try {
    const executable = await readlink(`/proc/${pid}/exe`);
    if (!executable.startsWith(`${installation}/`)) return null;
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) !== process.getuid()) return null;
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const { parentPid, startTime } = readLinuxProcessStat(stat);
    if (processTracker.reused(pid, startTime)) return null;
    // Executable path, UID and start ticks now establish ownership. A later
    // cmdline/status/exe read denial must not turn this PID into an exit proof.
    processTracker.remember(pid, startTime);
    const commandLine = inspectLinuxCommandLine(await readFile(`/proc/${pid}/cmdline`));
    return { pid: Number(pid), parentPid, executable, startTime, argv: commandLine.argv, commandLine, status };
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) { processTracker.forget(pid); return null; }
    if (['EACCES', 'EPERM'].includes(error.code)) {
      if (processTracker.has(pid)) {
        try {
          const current = readLinuxProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8'));
          if (processTracker.reused(pid, current.startTime)) return null;
        } catch (statError) {
          if (['ENOENT', 'ESRCH'].includes(statError.code)) { processTracker.forget(pid); return null; }
          // An unreadable/invalid stat cannot establish PID reuse or exit.
        }
      }
      return processTracker.readDenied(pid);
    }
    throw error;
  }
}

async function processes(installation) {
  const entries = await readdir('/proc');
  return (await Promise.all(entries.filter(name => /^\d+$/.test(name)).map(pid => installedProcess(pid, installation)))).filter(Boolean);
}

function mainProcesses(entries, executable) {
  return inspectInstalledProcessTree(entries, executable).mains;
}

function processCounts(entries, executable) {
  return inspectInstalledProcessTree(entries, executable).diagnostics;
}

// Classify in memory. Never persist stderr, argv, URLs, filesystem paths or tokens.
function stderrCategory(value) {
  const text = typeof value === 'string' ? value : '';
  if (/no usable sandbox|suid sandbox helper|failed to move to new namespace|running as root without --no-sandbox|zygote_host_impl_linux|apparmor[^\n]*(?:denied|userns)/i.test(text)) return 'sandbox';
  if (/missing x server|cannot open display|could not connect to display|unable to open x display|failed to connect to (?:the )?(?:x11|x server|wayland)|ozone_platform_x11|platform failed to initialize/i.test(text)) return 'display';
  if (/ERR_MODULE_NOT_FOUND|cannot find (?:module|package)|apps\.generated\.json|preferences\.json|(?:ENOENT|EACCES|permission denied)[^\n]*(?:config|profile|production)|(?:config|profile|production)[^\n]*(?:ENOENT|EACCES|permission denied)|등록된 웹앱 설정|연결 앱 설정/i.test(text)) return 'configuration';
  return 'unknown';
}

async function processDiagnostic(record) {
  if (!record) return null;
  const result = record.closed ? await record.done : { code: record.child.exitCode, signal: record.child.signalCode };
  const signals = ['SIGABRT', 'SIGTRAP', 'SIGSEGV', 'SIGILL', 'SIGBUS', 'SIGFPE', 'SIGKILL', 'SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGPIPE'];
  return { started: Number.isSafeInteger(record.pid), closed: record.closed,
    exitCode: Number.isSafeInteger(result?.code) ? result.code : null,
    exitSignal: signals.includes(result?.signal) ? result.signal : null,
    stderrPresent: Boolean(record.stderr), stderrCategory: stderrCategory(record.stderr) };
}

async function stopProcesses(installation) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    const entries = await processes(installation);
    if (!entries.length) return;
    for (const entry of entries) {
      const current = await installedProcess(entry.pid, installation);
      if (current?.startTime === entry.startTime) {
        try { process.kill(entry.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
    try { await until(async () => !(await processes(installation)).length, 'owned installed processes to exit', 5_000); return; }
    catch (error) { if (signal === 'SIGKILL') throw error; }
  }
}

export function assertLinuxRejectedState(state, description) {
  assert.equal(state.stage, 'error'); assert.equal(state.description, description);
  assert.equal(state.attemptId, null); assert.ok(Array.isArray(state.providers));
  assert.equal(state.connectionStatus, 'disconnected'); assert.equal(state.webReady, false);
  assert.deepEqual(state.activity, { kind: 'idle' });
  assert.equal(state.autoStart, false); assert.equal(state.pet, false);
}

/** Actual .deb install/URI/remove. The caller owns hosted-runner and desktop-session guards. */
export async function verifyLinuxInstallation({ configuration, context, qaRoot, evidence }) {
  evidence.phase = 'linux_prepare';
  assert.equal(process.platform, 'linux'); assert.ok(process.getuid() > 0);
  assert.ok(!process.env.ELECTRON_DISABLE_SANDBOX && !process.env.ELECTRON_RUN_AS_NODE, 'Packaged sandbox/runtime overrides are forbidden');
  const { connectorRoot, productName, scheme, packageVersion } = configuration;
  assertInside(await realpath(connectorRoot), await realpath(context.workspace));
  assertInside(await realpath(qaRoot), await realpath(context.runnerTemp));
  const candidates = (await readdir(join(connectorRoot, 'dist'))).filter(name => name.endsWith('.deb'));
  assert.equal(candidates.length, 1, 'Exactly one Debian package is required');
  const deb = join(connectorRoot, 'dist', candidates[0]);
  assertInside(await realpath(deb), await realpath(context.workspace));
  const packageSha256 = await fileHash(deb);
  const fields = await Promise.all(['Package', 'Version', 'Architecture'].map(field => run('dpkg-deb', ['--field', deb, field])));
  const [packageName, version, architecture] = fields.map(result => result.stdout.trim());
  assert.match(packageName, /^[a-z0-9][a-z0-9+.-]{0,100}$/);
  assert.equal(version, packageVersion); assert.equal(architecture, 'amd64');
  const pkg = JSON.parse(await readFile(join(connectorRoot, 'desktop', 'package.json'), 'utf8'));
  assert.equal(packageName, configuration.packageName);
  const knownPackage = await run('dpkg-query', ['--show', '--showformat=${db:Status-Status}', packageName], { allowFailure: true });
  assert.equal(knownPackage.code, 1, 'Existing or partially removed package must not be changed');
  const mime = `x-scheme-handler/${scheme}`;
  const originalHandler = (await run('xdg-mime', ['query', 'default', mime])).stdout.trim();
  assert.equal(originalHandler, '', 'An existing URI handler must not be changed');
  const appData = resolve(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'));
  const profilePaths = [...new Set([productName, pkg.name, configuration.stableProfileName].filter(name => typeof name === 'string')
    .map(name => assertInside(join(appData, name), appData)))];
  if (configuration.profileRelativePath?.length) profilePaths.push(assertInside(join(appData, ...configuration.profileRelativePath), appData));
  for (const profile of profilePaths) assert.equal(await exists(profile), false, 'Existing app profile must not be changed');
  const inspection = await createOwnedDirectory(qaRoot, 'linux-deb-inspection-');
  let installed = false, installAttempted = false, installationOwned = false, installation, executable, desktopInstalled, appArmor, client, launched, coldOpener, warmOpener;
  const openers = [];
  let failure, failedPhase;
  const details = evidence.linux = { packageName, version, architecture, packageSha256 };
  evidence.cleanup ??= {};
  evidence.limits ??= [];
  evidence.limits.push('Linux cold URI: installed PID, exact synthetic URI cmdline field/title token, window and screenshot are observed; mutable process titles do not prove original argv, and cold renderer state is not inspected by CDP.',
    'Process observations cover matched installed executables/UIDs and the readable /proc scope, not every sandbox descendant; loss of access to a previously confirmed owned PID defers cleanup to runner disposal.',
    'Production API and CLI inference are excluded by invalid-URI parser control flow before credentials/ACK; local CLI metadata discovery is allowed. Independent network-wire measurement is not performed.',
    'Packaged URI tests do not verify real pairing, credential encryption, AI inference or Wayland.');
  try {
    evidence.phase = 'linux_archive';
    const data = join(inspection.path, 'data'), control = join(inspection.path, 'control');
    await run('dpkg-deb', ['--extract', deb, data]);
    await run('dpkg-deb', ['--control', deb, control]);
    const applicationDirectory = join(data, 'usr', 'share', 'applications');
    const desktopNames = (await readdir(applicationDirectory)).filter(name => name.endsWith('.desktop'));
    assert.equal(desktopNames.length, 1);
    const desktopSource = join(applicationDirectory, desktopNames[0]);
    const desktopText = await readFile(desktopSource, 'utf8');
    assert.equal(/^Name=(.*)$/m.exec(desktopText)?.[1], productName);
    assert.ok(/^MimeType=(.*)$/m.exec(desktopText)?.[1].split(';').includes(mime));
    const command = /^Exec=(?:"([^"\r\n]+)"|(\S+)) %U$/m.exec(desktopText);
    assert.ok(command, 'Desktop must launch the installed executable with the URI only');
    executable = command[1] || command[2];
    assert.match(executable, /^\/opt\/[^/]+\/[^/]+$/);
    assert.equal(resolve(executable), executable);
    installation = dirname(executable);
    desktopInstalled = join('/usr/share/applications', desktopNames[0]);
    appArmor = join('/etc/apparmor.d', basename(executable));
    for (const path of [installation, desktopInstalled, appArmor, join('/usr/bin', basename(executable)), join('/etc/alternatives', basename(executable))]) {
      assert.equal(await exists(path), false, 'Existing installation footprint must not be changed');
    }
    assert.notEqual(await loadedAppArmorProfile(basename(executable)), true, 'Existing kernel AppArmor profile must not be changed');
    assert.equal((await processes(installation)).length, 0, 'Existing installed processes must not be changed');
    const postinst = await readFile(join(control, 'postinst'), 'utf8');
    const scripts = await Promise.all(['preinst', 'postinst', 'prerm', 'postrm'].map(async name => await exists(join(control, name)) ? readFile(join(control, name), 'utf8') : ''));
    const forbidden = /--(?:no-sandbox|disable-sandbox|disable-setuid-sandbox|disable-seccomp-filter-sandbox|disable-namespace-sandbox|no-zygote-sandbox)|ELECTRON_DISABLE_SANDBOX|apparmor_restrict_unprivileged_userns\s*=\s*0/;
    assert.ok(!forbidden.test(desktopText + scripts.join('\n')), 'Sandbox bypass is forbidden');
    assert.match(postinst, /chmod 4755 .*\/chrome-sandbox/); assert.match(postinst, /chmod 0755 .*\/chrome-sandbox/);
    await run('desktop-file-validate', [desktopSource]);
    evidence.checks.push('linux_clean_package_profile_handler_and_installation_guards');

    evidence.phase = 'linux_install';
    installAttempted = true;
    await run('sudo', ['-n', 'apt-get', 'install', '-y', '--no-install-recommends', deb], { timeout: 180_000, env: { DEBIAN_FRONTEND: 'noninteractive' } });
    installed = installationOwned = true; // Only successful installation in the empty slot authorizes purge.
    assert.equal((await run('dpkg-query', ['--show', '--showformat=${db:Status-Status}', packageName])).stdout.trim(), 'installed');
    assert.equal(await realpath(executable), executable);
    const bundledNode = JSON.parse((await run(executable, ['-e', 'process.stdout.write(JSON.stringify({node:process.versions.node,arch:process.arch}))'], { env: { ELECTRON_RUN_AS_NODE: '1' } })).stdout);
    assert.equal(bundledNode.arch, process.arch); assert.ok(Number(bundledNode.node.split('.')[0]) >= 22);
    details.bundledNode = bundledNode;
    assert.equal(await fileHash(desktopInstalled), await fileHash(desktopSource));
    assert.equal(await fileHash(executable), await fileHash(join(data, relative('/', executable))));
    const resources = join(installation, 'resources');
    details.installedCore = await verifyInstalledCore(resources, join(connectorRoot, 'core'));
    const sandbox = await lstat(join(installation, 'chrome-sandbox'));
    const sandboxMode = sandbox.mode & 0o7777;
    assert.ok(sandbox.isFile() && !sandbox.isSymbolicLink()); assert.equal(sandbox.uid, 0); assert.equal(sandbox.gid, 0);
    assert.ok([0o755, 0o4755].includes(sandboxMode), 'Keep the installer-selected sandbox mode');
    const sandboxSha256 = await fileHash(join(installation, 'chrome-sandbox'));
    assert.equal(sandboxSha256, await fileHash(join(data, relative('/', installation), 'chrome-sandbox')));
    const mount = (await run('findmnt', ['--noheadings', '--output', 'OPTIONS', '--target', join(installation, 'chrome-sandbox')])).stdout.trim();
    assert.ok(!mount.split(',').includes('nosuid'));
    const appArmorPresent = await exists(appArmor), appArmorLoaded = await loadedAppArmorProfile(basename(executable));
    if (appArmorPresent) {
      assert.equal(await fileHash(appArmor), await fileHash(join(resources, 'apparmor-profile')));
      assert.equal(appArmorLoaded, true, 'Installer-created AppArmor profile must be loaded');
    }
    details.sandbox = { owner: 'root:root', mode: sandboxMode.toString(8), sha256: sandboxSha256, appArmorProfilePresent: appArmorPresent, appArmorLoaded, modeChangedByQa: false };
    assert.equal((await run('xdg-mime', ['query', 'default', mime])).stdout.trim(), desktopNames[0], 'Installed scheme must resolve without rewriting the desktop entry');
    evidence.checks.push('linux_actual_deb_install_core_hashes_sandbox_and_default_protocol');
    evidence.checks.push('linux_installed_bundled_node_without_external_node_installation');

    evidence.phase = 'linux_cold_pid';
    const coldUri = `${scheme}://connect?attemptId=ci-package-cold`;
    details.cold = { launchedBy: 'xdg-open', installedBinary: false, uriTokenObserved: false,
      originalArgvProven: false,
      visibleWindowObserved: false, rendererStateObserved: false, closeRequested: false,
      processExitObserved: false, mainExitCodeObserved: false, peakMainProcesses: 0 };
    coldOpener = start('xdg-open', [coldUri]); openers.push(coldOpener);
    const cold = await until(async () => {
      const entries = await processes(installation), observed = inspectInstalledProcessTree(entries, executable);
      const mains = observed.mains;
      details.cold.lastProcessCounts = observed.diagnostics;
      const uriObservations = entries.map(entry => observeSyntheticUri(entry.commandLine, coldUri));
      details.cold.lastProcessCounts.exactUriCmdlineFieldProcesses = uriObservations.filter(value => value.exactCmdlineField).length;
      details.cold.lastProcessCounts.exactUriTitleTokenProcesses = uriObservations.filter(value => value.source === 'process-title-token').length;
      details.cold.peakMainProcesses = Math.max(details.cold.peakMainProcesses, mains.length);
      details.cold.uriObservation = mains.length === 1 ? observeSyntheticUri(mains[0].commandLine, coldUri) : null;
      return mains.length === 1 && observed.diagnostics.disconnectedSameExecutable === 0
        && observed.diagnostics.cycleProcesses === 0 && details.cold.uriObservation.observed ? mains[0] : false;
    }, 'cold xdg-open to launch the installed binary');
    details.cold.installedBinary = true; details.cold.uriTokenObserved = true;
    evidence.phase = 'linux_cold_visible_window';
    const windowId = await until(async () => {
      const result = await run('xdotool', ['search', '--onlyvisible', '--pid', String(cold.pid)], { allowFailure: true, timeout: 2_000 });
      details.cold.lastWindowSearchExitCode = result.code;
      details.cold.windowSearchStderrCategory = stderrCategory(result.stderr);
      return result.code === 0 ? result.stdout.trim().split(/\s+/).find(value => /^\d+$/.test(value)) : false;
    }, 'the cold installed application window');
    details.cold.visibleWindowObserved = true;
    evidence.phase = 'linux_cold_capture';
    await run('scrot', ['--overwrite', join(qaRoot, 'linux-installed-cold.png')]);
    details.cold.screenshot = 'linux-installed-cold.png';
    evidence.phase = 'linux_cold_close_window';
    const numericWindowId = BigInt(windowId);
    assert.ok(numericWindowId > 0n && numericWindowId <= 0xffffffffn, 'Invalid owned X11 window ID');
    const windowOwner = (await run('xdotool', ['getwindowpid', windowId])).stdout.trim();
    assert.equal(windowOwner, String(cold.pid), 'The cold window changed process ownership');
    const currentCold = await installedProcess(cold.pid, installation);
    assert.ok(currentCold && currentCold.startTime === cold.startTime && currentCold.executable === executable,
      'The installed cold process changed before its window close request');
    // Ask the window manager to close normally. XDestroyWindow (xdotool
    // windowclose) bypasses the application's close/window-all-closed boundary.
    await run('wmctrl', ['-ic', `0x${numericWindowId.toString(16)}`]);
    details.cold.closeRequested = true;
    evidence.phase = 'linux_cold_process_exit';
    await until(async () => !(await processes(installation)).length, 'cold application window close to exit all installed processes');
    details.cold.processExitObserved = true;
    evidence.phase = 'linux_cold_opener_exit';
    await until(() => coldOpener.closed, 'cold desktop opener to exit');
    details.cold.opener = await processDiagnostic(coldOpener);
    const openerExit = await coldOpener.done;
    assert.equal(openerExit.code, 0, 'Cold desktop URI opener failed');
    assert.equal(openerExit.signal, null, 'Cold desktop URI opener was terminated');
    evidence.checks.push('linux_unmodified_desktop_cold_uri_binary_title_token_window_and_close');

    evidence.phase = 'linux_packaged_cdp';
    const port = await reserveDebugPort();
    launched = start(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', coldUri]);
    client = await connectInstalledApp(port, join(resources, 'app.asar', 'renderer', 'index.html'));
    const rejected = '연결 링크에 허용되지 않은 정보가 있어요.';
    await until(async () => { const state = await client.state(); return state.stage === 'error' && state.description === rejected; }, 'packaged cold URI rejection');
    assertLinuxRejectedState(await client.state(), rejected);
    evidence.phase = 'linux_packaged_cdp_native_processes';
    const nativeProcesses = await getInstalledBrowserProcesses(port);
    const directEntries = await processes(installation);
    const directObservation = inspectInstalledProcessTree(directEntries, executable);
    details.sandbox.processObservation = directObservation.diagnostics;
    details.sandbox.nativeProcesses = nativeProcesses;
    details.sandbox.processTypeEvidence = 'cdp-browser-target-SystemInfo.getProcessInfo';
    const renderers = verifyLinuxCdpRenderers(directEntries,
      { executable, mainPid: launched.pid, uid: process.getuid() }, nativeProcesses);
    details.sandbox.renderers = renderers.map(entry => {
      assert.ok(!entry.argv.some(arg => forbidden.test(arg)));
      return { pid: entry.pid, nativeType: 'renderer', ownedBrowserAncestor: true,
        exactInstalledExecutable: true, matchingUid: true, seccomp: 2, noNewPrivileges: true };
    });
    evidence.checks.push('linux_packaged_renderer_cdp_parser_rejection_and_live_sandbox');

    evidence.phase = 'linux_warm_uri';
    warmOpener = start('xdg-open', [`${scheme}://invalid`]); openers.push(warmOpener);
    const warmRejected = '등록된 앱의 연결 링크를 사용해 주세요.';
    await until(async () => { const state = await client.state(); return state.stage === 'error' && state.description === warmRejected; }, 'warm URI to reach the existing packaged instance');
    assertLinuxRejectedState(await client.state(), warmRejected);
    await until(async () => {
      const entries = mainProcesses(await processes(installation), executable);
      return entries.length === 1 && entries[0].pid === launched.pid;
    }, 'one unchanged installed application instance');
    await until(() => warmOpener.closed, 'warm desktop opener to exit');
    for (const profile of profilePaths) {
      assert.equal(await exists(join(profile, 'devices.enc.json')), false, 'Invalid URI must not create device credentials');
      assert.equal(await exists(join(profile, 'preferences.json')), false, 'Invalid URI must not start the first-run web flow');
    }
    if (configuration.stableProfileName && !configuration.profileRelativePath?.length) {
      assert.equal(await exists(join(appData, configuration.stableProfileName)), true, 'The stable credential profile must be retained.');
      if (configuration.stableProfileName !== productName) {
        assert.equal(await exists(join(appData, productName)), false, 'Display branding must not move the credential profile.');
      }
      details.profile = { mode: 'stable-profile-name', stableProfileCreated: true, displayNameProfileCreated: false };
    }
    details.warm = { launchedBy: 'xdg-open', sameMainPid: true, distinctParserErrorObserved: true, deviceCredentialsCreated: false };
    evidence.checks.push('linux_warm_protocol_single_instance_rejection_before_device_credentials');
    await client.quit(); client.close(); client = null;
    await until(() => launched.closed, 'installed application IPC quit');
    assert.deepEqual(await launched.done, { code: 0, signal: null });
    await until(async () => !(await processes(installation)).length, 'packaged application and helpers to exit');
    details.normalQuit = true;
    evidence.checks.push('linux_packaged_ipc_quit_and_owned_process_exit');
  } catch (error) {
    failure = error; failedPhase = evidence.phase;
    // Preserve the pre-cleanup state: later termination/purge must not erase the launch diagnosis.
    evidence.linuxFailure = { phase: failedPhase, commandStderrCategory: stderrCategory(error?.result?.stderr) };
    try {
      evidence.linuxFailure.coldOpener = await processDiagnostic(coldOpener);
      evidence.linuxFailure.warmOpener = await processDiagnostic(warmOpener);
      evidence.linuxFailure.directApplication = await processDiagnostic(launched);
      evidence.linuxFailure.installedProcesses = installation ? processCounts(await processes(installation), executable) : { total: 0, main: 0, helper: 0, renderer: 0 };
    } catch {
      evidence.linuxFailure.snapshotUnavailable = true;
    }
  }
  try {
    evidence.phase = 'linux_cleanup';
    client?.close();
    if (failure?.code === 'OWNED_PROC_UNOBSERVABLE') throw failure;
    if (installAttempted && !installed) {
      // A failed/timeout apt command can have unpacked files. Do not claim a
      // clean uninstall or purge a package whose successful ownership is unknown.
      const status = await run('dpkg-query', ['--show', '--showformat=${db:Status-Status}', packageName], { allowFailure: true });
      const remaining = await Promise.all([installation, desktopInstalled, appArmor].map(async path => ({ kind: path === installation ? 'application' : path === desktopInstalled ? 'desktop' : 'apparmor', present: await exists(path) })));
      evidence.cleanup.linuxIncompleteInstall = { retainedForRunnerDisposal: true, packageState: status.code === 0 ? status.stdout.trim() : 'absent-or-unreadable', remaining };
    }
    if (installed) {
      await stopProcesses(installation);
      evidence.cleanup.linuxOwnedProcessesStopped = true;
      await run('sudo', ['-n', 'dpkg', '--purge', packageName], { timeout: 60_000 });
      installed = false;
      for (const path of [installation, executable, desktopInstalled, appArmor, join('/usr/bin', basename(executable)), join('/etc/alternatives', basename(executable))]) {
        assert.equal(await exists(path), false, 'Installed package footprint remains after purge');
      }
      assert.notEqual(await loadedAppArmorProfile(basename(executable)), true, 'Kernel AppArmor profile remains after purge');
      const removed = await run('dpkg-query', ['--show', '--showformat=${db:Status-Status}', packageName], { allowFailure: true });
      assert.equal(removed.code, 1);
      assert.equal((await run('xdg-mime', ['query', 'default', mime])).stdout.trim(), originalHandler);
      evidence.cleanup.linuxPackagePurged = true;
      evidence.cleanup.linuxAppArmorProfileUnloaded = true;
      evidence.checks.push('linux_package_protocol_and_apparmor_files_removed_without_autoremove');
    }
    if (installationOwned && installation && !(await processes(installation)).length) {
      for (const profile of profilePaths) {
        if (!await exists(profile)) continue;
        assertInside(profile, appData); assert.ok(!(await lstat(profile)).isSymbolicLink());
        assert.equal(await realpath(profile), profile);
        await rm(profile, { recursive: true }); // Each exact path was absent before this test.
      }
      evidence.cleanup.linuxFreshProfilesRemoved = true;
    }
  } catch (error) {
    if (error.code === 'OWNED_PROC_UNOBSERVABLE') {
      evidence.cleanup.linuxObservedProcessCleanupDeferred = true;
      evidence.cleanup.linuxRetainedForRunnerDisposal = true;
    }
    failure ??= error; failedPhase ??= evidence.phase;
  }
  finally {
    try {
      for (const opener of openers) {
        if (!opener.closed) { opener.child.kill('SIGTERM'); await until(() => opener.closed, 'owned URI opener cleanup', 5_000); }
      }
      evidence.cleanup.linuxUriOpenersStopped = openers.every(opener => opener.closed);
    } catch (error) { failure ??= error; failedPhase ??= 'linux_cleanup'; }
    await inspection.cleanup();
  }
  if (failure) { evidence.phase = failedPhase; throw failure; }
  evidence.phase = 'linux_complete';
}
