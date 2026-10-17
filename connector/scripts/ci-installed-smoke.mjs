/** Disposable hosted-runner package installation. No production pairing or inference. */
import { appendFile, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createOwnedDirectory, diagnostic, loadConfiguration, validateRunnerContext,
} from './installed-smoke-support.mjs';

const connectorRoot = dirname(dirname(fileURLToPath(import.meta.url)));
let evidence, artifact, owned;
try {
  // This precedes any filesystem write, installation or OS handler change.
  const workspace = await realpath(dirname(connectorRoot));
  const context = validateRunnerContext(process.env, { platform: process.platform, uid: process.getuid?.(), workspace });
  const configuration = await loadConfiguration(connectorRoot);
  const platform = process.platform === 'darwin' ? 'macos' : 'linux';
  artifact = join(connectorRoot, 'artifacts', `ci-installed-${platform}`);
  await mkdir(artifact, { recursive: true });
  evidence = {
    passed: false, mode: 'installed-unsigned-package-and-os-uri', platform, architecture: process.arch,
    recordedAt: new Date().toISOString(), source: process.env.GITHUB_SHA,
    appId: configuration.appId, packageVersion: configuration.packageVersion,
    checks: [], cleanup: {}, phase: 'preflight', cliInferenceRequested: false,
    limits: [
      'Unsigned local CI package; no internet-download quarantine, Finder/browser approval, publisher signing or notarization proof.',
      'Invalid links are rejected before identity storage, API ACK and adapter construction; main-process network traffic is not independently captured.',
      'Production pairing, actual model responses, reboot, Wayland and signed-update flows are outside this smoke.',
    ],
  };
  await writeFile(join(artifact, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
  owned = await createOwnedDirectory(context.runnerTemp, 'connector-installed-');
  const params = { configuration, context, qaRoot: owned.path, evidence };
  if (process.platform === 'darwin') await (await import('./ci-installed-macos.mjs')).verifyMacInstallation(params);
  else await (await import('./ci-installed-linux.mjs')).verifyLinuxInstallation(params);
  if (!evidence.checks.length) throw Object.assign(new Error('No installed checks were recorded'), { code: 'NO_CHECKS' });
  evidence.phase = 'temporary_cleanup';
  await owned.cleanup();
  evidence.cleanup.ownedTempRemoved = true;
  evidence.passed = true;
  evidence.phase = 'completed';
} catch (error) {
  process.exitCode = 1;
  if (evidence) {
    evidence.error = diagnostic(error, evidence.phase);
    // These commands only operate on public package metadata and generated QA
    // helpers. No real launch token, CLI credential or paper is constructed.
    if (error?.result && /^[a-zA-Z0-9_.+-]{1,80}$/.test(error.command ?? '')) {
      evidence.commandFailure = { command: error.command, exitCode: error.result.code,
        stderr: String(error.result.stderr ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-6000) };
    }
    evidence.cleanup.ownedTempRetainedOnFailure = !!owned;
  } else console.error(JSON.stringify({ passed: false, error: diagnostic(error, 'preflight') }));
} finally {
  if (evidence && artifact) {
    // Screenshots, if produced, stay local to this ephemeral runner by default.
    // The JSON is sufficient for CI logs; upload remains an explicit opt-in.
    const summary = JSON.stringify(evidence, null, 2);
    await writeFile(join(artifact, 'result.json'), summary + '\n');
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Installed package verification\n\n\`\`\`json\n${summary}\n\`\`\`\n`);
  }
}
