/** Installed DMG smoke for a disposable macOS runner; no product QA switches. */
import assert from 'node:assert/strict';
import { lstat, mkdir, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  run, until, reserveDebugPort, connectInstalledApp, fileHash,
  verifyInstalledCore, createOwnedDirectory, assertInside,
} from './installed-smoke-support.mjs';

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
          "started": application.launchDate?.timeIntervalSince1970 ?? 0]
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
  const { appId, productName, scheme, packageVersion, connectorRoot } = configuration;
  const profileRelativePath = configuration.profileRelativePath ?? [];
  assert.ok(Array.isArray(profileRelativePath));
  if (profileRelativePath.length) assert.deepEqual(profileRelativePath, [appId, 'production'],
    'Only the configured production profile may be inspected or removed.');
  assert.match(scheme, /^[a-z][a-z0-9+.-]*$/);
  assert.equal(basename(productName), productName, 'Product name must be one path segment.');
  await assertInside(qaRoot, context.runnerTemp);
  await assertInside(connectorRoot, context.workspace);
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
      packageVersion: publicMetadata(packageVersion), scheme: publicMetadata(scheme) },
    mount: {}, bundle: {},
    profile: { mode: profileRelativePath.length ? 'app-id-production' : 'bundle-name',
      relativePath: profileRelativePath.map(publicMetadata) },
  };
  const cleanup = evidence.cleanup.macos = { processesStopped: false, protocolUnregistered: false,
    applicationRemoved: false, profileRemoved: false, mountDetached: true, errors: [] };
  const coldUri = `${scheme}://wrong-host?attemptId=ci&launchToken=x`;
  const warmUri = `${scheme}://connect?extra=1`;
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  let helperDirectory, mountDirectory, mountPoint, installDirectory, installedApp, userData, resources, profileContainer;
  let profileContainerAbsent = false;
  let mounted = false, registered = false, profileAbsent = false, swiftReady = false, connection, failure;
  const owned = new Map();
  const startedAt = Date.now();
  const checked = description => evidence.checks.push(description);
  const swift = async (...args) => JSON.parse((await run(join(helperDirectory.path, 'workspace'), args)).stdout.trim());
  const comparablePath = value => typeof value === 'string' ? resolve(value).normalize('NFC') : null;
  const handler = async () => comparablePath((await swift('resolve', coldUri)).path);
  const plist = async (file, key, format = 'raw') => (await run('/usr/bin/plutil', ['-extract', key, format, '-o', '-', file])).stdout.trim();

  async function processIdentity(pid) {
    const response = await run('/bin/ps', ['-ww', '-p', String(pid), '-o', 'lstart=', '-o', 'comm='],
      { allowFailure: true, env: { LC_ALL: 'C' } });
    if (response.code !== 0 || !response.stdout.trim()) return null;
    const match = /^(.+?\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(response.stdout.trim());
    if (!match) return null;
    const executable = await realpath(match[2]).catch(() => null);
    if (!executable) return null;
    try { await assertInside(executable, installedApp); } catch { return null; }
    return { pid, born: match[1], executable };
  }
  async function sameProcess(identity) {
    const current = await processIdentity(identity.pid);
    return !!current && current.born === identity.born && current.executable === identity.executable;
  }
  async function captureProcesses(mainPid) {
    const main = await processIdentity(mainPid);
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
      const identity = await processIdentity(pid);
      if (identity) owned.set(pid, identity);
    }
  }
  async function allStopped() {
    return (await Promise.all([...owned.values()].map(sameProcess))).every(value => !value);
  }
  async function captureRemainingProcesses() {
    if (!installedApp || !(await exists(installedApp))) return;
    // Helpers may be reparented after a main-process crash. Read executable names,
    // never arbitrary process arguments, and accept only this unique owned bundle.
    const processes = await run('/bin/ps', ['-ww', '-U', String(process.getuid()), '-o', 'pid=', '-o', 'comm=']);
    const prefix = `${comparablePath(installedApp)}/`;
    for (const line of processes.stdout.trim().split('\n')) {
      const match = /^(\d+)\s+(.+)$/.exec(line.trim());
      if (!match || !comparablePath(match[2])?.startsWith(prefix)) continue;
      const identity = await processIdentity(Number(match[1]));
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
      assert.equal(await exists(join(parent, `${productName}.app`)), false, 'An existing installation must be preserved.');
    }
    const dist = join(connectorRoot, 'dist');
    await assertInside(dist, connectorRoot);
    const suffix = `-${packageVersion}-mac-${process.arch}.dmg`;
    const images = (await readdir(dist)).filter(name => name.endsWith(suffix));
    assert.equal(images.length, 1, 'Expected exactly one DMG for this package version and native architecture.');
    const image = join(dist, images[0]);
    const imageStat = await lstat(image);
    assert.ok(imageStat.isFile() && !imageStat.isSymbolicLink(), 'DMG must be a regular, non-symlink file.');
    await assertInside(await realpath(image), dist);
    result.dmg = { filename: basename(image), sha256: await fileHash(image), bytes: imageStat.size };

    evidence.phase = 'macos_dmg_mount_directory';
    mountDirectory = await createOwnedDirectory(qaRoot, 'mac-volume-');
    // Leave the directory's ownership marker outside the actual empty mountpoint.
    mountPoint = join(mountDirectory.path, 'volume'); await mkdir(mountPoint);
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
    if (Array.isArray(entities)) metadata.mount.entities = entities.slice(0, 16).map(entry => ({
      hasMountPoint: typeof entry?.['mount-point'] === 'string',
      mountPointMatched: entry?.['mount-point'] === mountPoint,
      normalizedMountPointMatched: typeof entry?.['mount-point'] === 'string'
        && comparablePath(entry['mount-point']) === comparablePath(mountPoint),
      devEntryValid: /^\/dev\/disk\d+(?:s\d+)*$/.test(entry?.['dev-entry'] ?? ''),
    }));
    const volume = entities.find(entry => entry['mount-point'] === mountPoint);
    metadata.mount.mountPointMatched = !!volume;
    metadata.mount.devEntryValid = !!volume && /^\/dev\/disk\d+(?:s\d+)*$/.test(volume['dev-entry']);
    evidence.phase = 'macos_mount_device_assert';
    assert.ok(volume && /^\/dev\/disk\d+(?:s\d+)*$/.test(volume['dev-entry']), 'Unexpected mounted DMG device.');
    evidence.phase = 'macos_dmg_app_names';
    const appNames = (await readdir(mountPoint)).filter(name => name.endsWith('.app'));
    metadata.mount.appNameCount = appNames.length;
    metadata.mount.appNames = appNames.slice(0, 10).map(publicMetadata);
    metadata.mount.appNamesAscii = appNames.slice(0, 10).map(name => /^[\x20-\x7e]+$/.test(name));
    metadata.mount.configuredAppName = publicMetadata(`${productName}.app`);
    metadata.mount.appNamesNormalized = appNames.slice(0, 10).map(name => publicMetadata(name.normalize('NFC')));
    assert.deepEqual(appNames.map(name => name.normalize('NFC')), [`${productName}.app`.normalize('NFC')],
      'DMG app name differs from the configured product.');
    evidence.phase = 'macos_dmg_app_directory';
    const sourceApp = join(mountPoint, appNames[0]);
    const sourceAppStat = await lstat(sourceApp);
    metadata.mount.appIsDirectory = sourceAppStat.isDirectory();
    metadata.mount.appIsSymlink = sourceAppStat.isSymbolicLink();
    assert.ok(sourceAppStat.isDirectory(), 'DMG app is not a real directory.');
    await assertInside(await realpath(sourceApp), mountPoint);
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
    evidence.phase = 'macos_profile_path';
    const profileParent = join(homedir(), 'Library', 'Application Support');
    userData = profileRelativePath.length ? join(profileParent, ...profileRelativePath) : join(profileParent, bundleName);
    await assertInside(userData, profileParent);
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
        const actualProfileParent = comparablePath(await realpath(profileContainer));
        metadata.profile.parentRealpathMatched = actualProfileParent === comparablePath(profileContainer);
        assert.equal(actualProfileParent, comparablePath(profileContainer));
      }
    }
    evidence.phase = 'macos_profile_absence';
    const profileExists = await exists(userData);
    metadata.profile.exists = profileExists;
    assert.equal(profileExists, false, 'An existing production profile must be preserved.');
    profileAbsent = true;

    evidence.phase = 'macos_copy';
    installDirectory = await createOwnedDirectory('/Applications', 'connector-ci-mac-');
    installedApp = join(installDirectory.path, `${productName}.app`);
    await assertInside(installedApp, installDirectory.path);
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
    assert.ok((await lstat(executable)).isFile(), 'Installed executable is missing.');
    await assertInside(await realpath(executable), installedApp);
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
    const gatekeeper = await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', installedApp], { allowFailure: true });
    const quarantine = await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', installedApp], { allowFailure: true });
    result.distribution = { signatureExitCode: signature.code,
      developerId: /Authority=Developer ID Application:/.test(signature.stderr),
      adHoc: /Signature=adhoc/.test(signature.stderr), gatekeeperAccepted: gatekeeper.code === 0,
      gatekeeperExitCode: gatekeeper.code, quarantinePresent: quarantine.code === 0,
      quarantineModified: false, notarizationVerified: false };

    evidence.phase = 'macos_protocol_registration';
    registered = true; // Cleanup also unregisters a partially successful registration.
    await run(lsregister, ['-f', installedApp]);
    assert.equal(await handler(), comparablePath(installedApp), 'LaunchServices did not select the installed copied app.');
    checked('LaunchServices URI resolution selected the copied Applications bundle.');

    const renderer = join(resources, 'app.asar', 'renderer', 'index.html');
    for (let sequence = 1; sequence <= 2; sequence += 1) {
      evidence.phase = sequence === 1 ? 'macos_cold_uri_launch' : 'macos_restarted_cold_uri_launch';
      assert.deepEqual((await swift('running', appId)).applications, [], 'The prior app process is still running.');
      const port = await reserveDebugPort();
      const launched = (await swift('launch', coldUri, `--remote-debugging-port=${port}`)).application;
      assert.ok(launched && Number.isSafeInteger(launched.pid) && launched.pid > 1, 'LaunchServices could not launch the installed app.');
      assert.equal(await realpath(launched.path), installedApp, 'A source or translocated bundle was launched.');
      await assertInside(await realpath(launched.executable), installedApp);
      result.mainPids.push(launched.pid);
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
      connection = await connectInstalledApp(port, renderer);
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
  } catch (error) { failure = error; }
  finally {
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
          for (const identity of [...owned.values()].reverse()) if (await sameProcess(identity)) {
            process.kill(identity.pid, signal);
          }
          try { await until(allStopped, 'owned installed macOS process cleanup', 5_000); break; } catch {}
        }
      }
      assert.ok(await allStopped(), 'An owned installed process remains.');
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
      if (await exists(userData)) {
        const stat = await lstat(userData);
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
          && stat.birthtimeMs >= startedAt - 2_000, 'The app profile is not a newly owned directory.');
        assert.equal(comparablePath(await realpath(userData)), comparablePath(userData));
        await assertInside(userData, join(homedir(), 'Library', 'Application Support'));
        await rm(userData, { recursive: true });
      }
      cleanup.profileRemoved = !(await exists(userData));
      // The common kit creates an app-ID parent. Remove it only if it was absent
      // before this run and is now empty; a pre-existing development profile stays.
      if (profileContainerAbsent && profileContainer && await exists(profileContainer)) {
        const parentStat = await lstat(profileContainer);
        assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink() && parentStat.uid === process.getuid()
          && parentStat.birthtimeMs >= startedAt - 2_000, 'App profile parent is not newly owned.');
        assert.equal(comparablePath(await realpath(profileContainer)), comparablePath(profileContainer));
        await rmdir(profileContainer);
      }
    });
    if (mounted) await clean('volume-detach', async () => {
      await run('/usr/bin/hdiutil', ['detach', mountPoint]); mounted = false; cleanup.mountDetached = true;
    });
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
