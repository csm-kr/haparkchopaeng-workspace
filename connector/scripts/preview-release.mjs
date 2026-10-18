/** Draft-only preview uploads. This helper never creates tags or publishes a release. */
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const shaPattern = /^[a-f0-9]{40}$/;
const expectedJobs = ['web', 'postgres', 'connector (windows-latest, win, x64)',
  'connector (macos-15, mac, arm64)', 'connector (macos-15-intel, mac, x64)',
  'connector (ubuntu-24.04, linux, x64)'];

function requireValue(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

async function verifyRemoteTag(repository, tag, source, github) {
  const prefix = `repos/${repository}`;
  const ref = await github(`${prefix}/git/ref/tags/${encodeURIComponent(tag)}`);
  let object = ref?.object;
  for (let depth = 0; object?.type === 'tag' && depth < 8; depth += 1) {
    requireValue(shaPattern.test(object.sha ?? ''), 'REMOTE_TAG_MISMATCH');
    object = (await github(`${prefix}/git/tags/${object.sha}`))?.object;
  }
  requireValue(object?.type === 'commit' && object.sha === source, 'REMOTE_TAG_MISMATCH');
}

async function findPreviewRelease(repository, tag, github) {
  // GitHub's by-tag endpoint exposes published releases; drafts require the authenticated list.
  const releases = await github(`repos/${repository}/releases?per_page=100`);
  requireValue(Array.isArray(releases) && releases.length <= 100, 'DRAFT_PREVIEW_REQUIRED');
  const matches = releases.filter(release => release?.tag_name === tag);
  requireValue(matches.length === 1, 'DRAFT_PREVIEW_REQUIRED');
  return matches[0];
}

export async function preflightPreview({ env, head, github }) {
  const repository = env.GITHUB_REPOSITORY;
  const tag = env.PREVIEW_RELEASE_TAG;
  const source = env.PREVIEW_EXPECTED_SHA;
  requireValue(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ''), 'INVALID_REPOSITORY');
  requireValue(typeof tag === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(tag)
    && !tag.includes('..') && !tag.endsWith('.') && !tag.endsWith('.lock'), 'INVALID_RELEASE_TAG');
  requireValue(shaPattern.test(source ?? '') && env.GITHUB_SHA === source && head === source, 'SOURCE_MISMATCH');
  requireValue(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF_TYPE === 'tag'
    && env.GITHUB_REF === `refs/tags/${tag}`, 'TAG_DISPATCH_REQUIRED');
  const prefix = `repos/${repository}`;
  await verifyRemoteTag(repository, tag, source, github);
  const release = await findPreviewRelease(repository, tag, github);
  requireValue(Number.isSafeInteger(release?.id) && release.id > 0 && release.tag_name === tag
    && release.draft === true && release.prerelease === true && release.target_commitish === source,
  'DRAFT_PREVIEW_REQUIRED');
  const runs = await github(`${prefix}/actions/workflows/local-agent.yml/runs?head_sha=${source}&status=success&per_page=100`);
  const candidates = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs.filter(candidate => Number.isSafeInteger(candidate.id) && candidate.id > 0
    && candidate.event === 'workflow_dispatch' && candidate.path === '.github/workflows/local-agent.yml' && candidate.head_sha === source
    && candidate.head_repository?.full_name === repository && candidate.status === 'completed'
    && candidate.conclusion === 'success') : [];
  for (const run of candidates) {
    const response = await github(`${prefix}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    const jobs = response?.jobs;
    if (response?.total_count === expectedJobs.length && Array.isArray(jobs) && jobs.length === expectedJobs.length
      && new Set(jobs.map(job => job.name)).size === expectedJobs.length
      && expectedJobs.every(name => jobs.some(job => job.name === name
        && job.status === 'completed' && job.conclusion === 'success'))) {
      return { repository, tag, source, releaseId: release.id, validationRunId: run.id };
    }
  }
  requireValue(false, 'SUCCESSFUL_VALIDATION_REQUIRED');
}

async function ownedFile(root, path) {
  const file = resolve(root, path);
  requireValue(!relative(root, file).startsWith('..') && await realpath(file) === file, 'ARTIFACT_PATH_INVALID');
  const stat = await lstat(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), 'ARTIFACT_PATH_INVALID');
  return { file, stat };
}

async function ownedJson(root, path) {
  const { file, stat } = await ownedFile(root, path);
  requireValue(stat.size > 0 && stat.size <= 2_000_000, 'ARTIFACT_JSON_INVALID');
  return JSON.parse(await readFile(file, 'utf8'));
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function uploadPreview({ env, head, root, runtime, github, upload }) {
  requireValue(env.GITHUB_ACTIONS === 'true' && env.CI === 'true' && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '')
    && Number.isSafeInteger(Number(env.GITHUB_RUN_ID)),
    'ACTIONS_UPLOAD_REQUIRED');
  const platform = env.PREVIEW_PLATFORM;
  const architecture = env.PREVIEW_ARCHITECTURE;
  requireValue(runtime?.architecture === architecture
    && ((platform === 'mac' && runtime.platform === 'darwin' && ['arm64', 'x64'].includes(architecture))
      || (platform === 'linux' && runtime.platform === 'linux' && architecture === 'x64')), 'NATIVE_ARCHITECTURE_REQUIRED');
  root = await realpath(root);
  requireValue(root === await realpath(env.GITHUB_WORKSPACE), 'WORKSPACE_MISMATCH');
  const authorization = await preflightPreview({ env, head, github });
  const version = (await ownedJson(root, 'connector/desktop/package.json')).version;
  requireValue(typeof version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(version)
    && version.length < 80, 'PACKAGE_VERSION_INVALID');
  const os = platform === 'mac' ? 'macos' : 'linux';
  const extension = platform === 'mac' ? 'dmg' : 'deb';
  // electron-builder uses Debian's amd64 spelling only for the input package filename.
  const packageArchitecture = platform === 'linux' ? 'amd64' : architecture;
  const filename = `hapark-connector-${version}-${platform}-${packageArchitecture}.${extension}`;
  const packageFile = await ownedFile(root, join('connector', 'dist', filename));
  requireValue(packageFile.stat.size > 0 && packageFile.stat.size < 2 * 1024 ** 3, 'PACKAGE_SIZE_INVALID');
  const installed = await ownedJson(root, `connector/artifacts/ci-installed-${os}/result.json`);
  const native = await ownedJson(root, `connector/artifacts/ci-desktop-smoke-${os}/result.json`);
  requireValue(installed.passed === true && installed.phase === 'completed' && installed.source === authorization.source
    && installed.mode === 'installed-unsigned-package-and-os-uri' && installed.platform === os
    && installed.architecture === architecture && installed.packageVersion === version
    && installed.cliInferenceRequested === false && Array.isArray(installed.checks)
    && installed.checks.length >= (platform === 'mac' ? 9 : 8), 'INSTALLED_RECEIPT_MISMATCH');
  requireValue(native.passed === true && native.stage === 'complete' && native.platform === os
    && native.architecture === architecture && native.mode === 'real-electron-real-os-encryption-mock-api'
    && native.build === 'unpackaged-ci' && native.mockKeychain === false && native.basicTextAllowed === false
    && native.cliInferenceJobsOffered === 0 && Array.isArray(native.checks) && native.checks.length >= 13
    && native.cleanup?.allOwnedAppsExited === true && native.cleanup?.loopbackClosed === true, 'NATIVE_RECEIPT_MISMATCH');
  requireValue(installed.cleanup?.ownedTempRemoved === true, 'INSTALLATION_CLEANUP_REQUIRED');
  if (platform === 'mac') {
    requireValue(['processesStopped', 'protocolUnregistered', 'applicationRemoved', 'profileRemoved', 'mountDetached']
      .every(key => installed.cleanup.macos?.[key] === true)
      && Array.isArray(installed.cleanup.macos?.errors) && installed.cleanup.macos.errors.length === 0,
    'INSTALLATION_CLEANUP_REQUIRED');
    requireValue(installed.macos?.architecture === architecture && installed.macos.dmg?.filename === filename
      && installed.macos.dmg.bytes === packageFile.stat.size, 'INSTALLED_PACKAGE_MISMATCH');
  } else {
    requireValue(['linuxOwnedProcessesStopped', 'linuxPackagePurged', 'linuxAppArmorProfileUnloaded',
      'linuxFreshProfilesRemoved', 'linuxUriOpenersStopped'].every(key => installed.cleanup[key] === true),
    'INSTALLATION_CLEANUP_REQUIRED');
    requireValue(installed.linux?.architecture === 'amd64', 'INSTALLED_PACKAGE_MISMATCH');
  }
  const name = `AI-Bridge-${version}-${platform}-${architecture}.${extension}`;
  const metadataName = `${name}.json`;
  const artifacts = join(root, 'connector', 'artifacts');
  requireValue(await realpath(artifacts) === artifacts && !(await lstat(artifacts)).isSymbolicLink(), 'ARTIFACT_PATH_INVALID');
  const staging = await mkdtemp(join(artifacts, `preview-release-${platform}-${architecture}-`));
  const binary = join(staging, name);
  await copyFile(packageFile.file, binary);
  const sha256 = await hashFile(binary);
  const expectedHash = platform === 'mac' ? installed.macos.dmg.sha256 : installed.linux.packageSha256;
  requireValue(/^[a-f0-9]{64}$/.test(expectedHash ?? '') && sha256 === expectedHash, 'PACKAGE_HASH_MISMATCH');
  const metadata = {
    schemaVersion: 1, name, version, platform: os, architecture, source: authorization.source,
    bytes: (await lstat(binary)).size, sha256, unsigned: true,
    runId: Number(env.GITHUB_RUN_ID), validationRunId: authorization.validationRunId,
    verification: { nativeEncryption: true, nativeChecks: native.checks.length,
      installedPackage: true, installedChecks: installed.checks.length },
    limits: ['Unsigned preview; publisher signing, notarization and Gatekeeper approval are not verified.',
      'Mock-API encryption and invalid-URI installation checks do not verify authenticated production pairing or model inference.'],
  };
  const metadataFile = join(staging, metadataName);
  await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  await verifyRemoteTag(authorization.repository, authorization.tag, authorization.source, github);
  const release = await findPreviewRelease(authorization.repository, authorization.tag, github);
  requireValue(release?.id === authorization.releaseId && release.tag_name === authorization.tag
    && release.draft === true && release.prerelease === true && release.target_commitish === authorization.source,
  'DRAFT_PREVIEW_REQUIRED');
  requireValue(Array.isArray(release.assets) && !release.assets.some(asset => [name, metadataName].includes(asset.name)),
    'RELEASE_ASSET_ALREADY_EXISTS');
  await upload({ repository: authorization.repository, tag: authorization.tag, files: [binary, metadataFile] });
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireValue(process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true', 'ACTIONS_UPLOAD_REQUIRED');
    const mode = process.argv[2];
    requireValue(process.argv.length === 3 && ['preflight', 'upload'].includes(mode), 'INVALID_PREVIEW_COMMAND');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const command = (file, args, code, timeout = 30_000) => {
      try {
        return execFileSync(file, args, { cwd: root, encoding: 'utf8', windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 4_000_000 });
      } catch { requireValue(false, code); }
    };
    const head = command('git', ['rev-parse', '--verify', 'HEAD'], 'CHECKOUT_UNAVAILABLE').trim();
    const github = async path => {
      const output = command('gh', ['api', '--hostname', 'github.com', '--method', 'GET', path], 'GITHUB_READ_FAILED');
      try { return JSON.parse(output); } catch { requireValue(false, 'GITHUB_RESPONSE_INVALID'); }
    };
    const result = mode === 'preflight'
      ? await preflightPreview({ env: process.env, head, github })
      : await uploadPreview({ env: process.env, head, root, github,
        runtime: { platform: process.platform, architecture: process.arch },
        upload: async ({ repository, tag, files }) => {
          command('gh', ['release', 'upload', tag, '--repo', `github.com/${repository}`, ...files],
            'GITHUB_UPLOAD_FAILED', 300_000);
        } });
    console.log(JSON.stringify({ passed: true, mode, ...result }));
  } catch (error) {
    process.exitCode = 1;
    console.error(JSON.stringify({ passed: false,
      code: /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code ?? '') ? error.code : 'PREVIEW_GUARD_FAILED' }));
  }
}
