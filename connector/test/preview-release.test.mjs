import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightPreview, uploadPreview } from '../scripts/preview-release.mjs';

const sha = 'a'.repeat(40);
const repository = 'example/research';
const tag = 'ai-bridge-v0.1.1-preview.1';
const env = {
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_TYPE: 'tag',
  GITHUB_REF: `refs/tags/${tag}`, GITHUB_SHA: sha, GITHUB_REPOSITORY: repository,
  PREVIEW_RELEASE_TAG: tag, PREVIEW_EXPECTED_SHA: sha,
};
const names = ['web', 'postgres', 'connector (windows-latest, win, x64)',
  'connector (macos-15, mac, arm64)', 'connector (ubuntu-24.04, linux, x64)'];

function githubFixture(overrides = {}) {
  const responses = {
    [`repos/${repository}/git/ref/tags/${tag}`]: { object: { type: 'commit', sha } },
    [`repos/${repository}/releases?per_page=100`]: [{
      id: 42, tag_name: tag, draft: true, prerelease: true, target_commitish: sha, assets: [],
    }],
    [`repos/${repository}/actions/workflows/local-agent.yml/runs?head_sha=${sha}&status=success&per_page=100`]: {
      workflow_runs: [{ id: 100, event: 'workflow_dispatch', path: '.github/workflows/local-agent.yml', head_sha: sha,
        head_repository: { full_name: repository }, status: 'completed', conclusion: 'success' }],
    },
    [`repos/${repository}/actions/runs/100/jobs?filter=latest&per_page=100`]: {
      total_count: names.length, jobs: names.map(name => ({ name, status: 'completed', conclusion: 'success' })),
    },
    ...overrides,
  };
  return async path => {
    assert.ok(Object.hasOwn(responses, path), 'Only the agreed GitHub read endpoints may be requested.');
    return structuredClone(responses[path]);
  };
}

test('only the tagged exact source, existing draft preview, and six successful validation jobs authorize upload', async () => {
  const result = await preflightPreview({ env, head: sha, github: githubFixture() });
  assert.deepEqual(result, { repository, tag, source: sha, releaseId: 42, validationRunId: 100 });
});

test('draft-only previews remain verifiable when the published-by-tag endpoint returns 404', async t => {
  const fixture = await packageFixture(t);
  const api = githubFixture();
  const github = async path => {
    if (path === `repos/${repository}/releases/tags/${tag}`) {
      throw Object.assign(new Error('Published-by-tag does not expose this draft.'), { status: 404 });
    }
    if (path === `repos/${repository}/releases?per_page=100`) return [
      { id: 41, tag_name: 'another-preview', draft: true, prerelease: true, target_commitish: sha, assets: [] },
      { id: 42, tag_name: tag, draft: true, prerelease: true, target_commitish: sha, assets: [] },
    ];
    return api(path);
  };
  assert.equal((await preflightPreview({ env, head: sha, github })).releaseId, 42);
  let uploads = 0;
  await uploadPreview({ ...fixture, head: sha, github, upload: async () => { uploads += 1; } });
  assert.equal(uploads, 1);
});

test('a missing or ambiguous exact tag within the first 100 releases is rejected', async t => {
  const matching = { id: 42, tag_name: tag, draft: true, prerelease: true, target_commitish: sha, assets: [] };
  for (const [label, releases] of [
    ['empty list', []],
    ['duplicate tag', [matching, { ...matching, id: 43 }]],
    ['absent in first 100', Array.from({ length: 100 }, (_, id) => ({ ...matching, id: id + 1, tag_name: `other-${id}` }))],
  ]) await t.test(label, async () => {
    const github = githubFixture({ [`repos/${repository}/releases?per_page=100`]: releases });
    await assert.rejects(preflightPreview({ env, head: sha, github }), { code: 'DRAFT_PREVIEW_REQUIRED' });
  });
});

test('the final upload refresh also rejects a newly ambiguous draft tag', async t => {
  const fixture = await packageFixture(t);
  const api = githubFixture();
  let reads = 0;
  let uploads = 0;
  const github = async path => {
    const result = await api(path);
    if (path === `repos/${repository}/releases?per_page=100` && ++reads > 1) {
      return [result[0], { ...result[0], id: 43 }];
    }
    return result;
  };
  await assert.rejects(uploadPreview({ ...fixture, head: sha, github,
    upload: async () => { uploads += 1; } }), { code: 'DRAFT_PREVIEW_REQUIRED' });
  assert.equal(uploads, 0);
});

test('an apparently successful run with a skipped native architecture cannot authorize release uploads', async () => {
  const github = githubFixture({
    [`repos/${repository}/actions/runs/100/jobs?filter=latest&per_page=100`]: {
      total_count: names.length, jobs: names.map(name => ({ name, status: 'completed',
        conclusion: name.includes('macos-15') ? 'skipped' : 'success' })),
    },
  });
  await assert.rejects(preflightPreview({ env, head: sha, github }), { code: 'SUCCESSFUL_VALIDATION_REQUIRED' });
});

test('PR merge-only validation cannot stand in for validation of the tagged source itself', async () => {
  const github = githubFixture({
    [`repos/${repository}/actions/workflows/local-agent.yml/runs?head_sha=${sha}&status=success&per_page=100`]: {
      workflow_runs: [{ id: 100, event: 'pull_request', path: '.github/workflows/local-agent.yml', head_sha: sha,
        head_repository: { full_name: repository }, status: 'completed', conclusion: 'success' }],
    },
  });
  await assert.rejects(preflightPreview({ env, head: sha, github }), { code: 'SUCCESSFUL_VALIDATION_REQUIRED' });
});

test('an annotated tag is peeled to its remote commit before authorizing the draft', async () => {
  const tagObject = 'b'.repeat(40);
  const github = githubFixture({
    [`repos/${repository}/git/ref/tags/${tag}`]: { object: { type: 'tag', sha: tagObject } },
    [`repos/${repository}/git/tags/${tagObject}`]: { object: { type: 'commit', sha } },
  });
  assert.equal((await preflightPreview({ env, head: sha, github })).source, sha);
});

test('branch dispatches and mismatched event, checkout, or requested source never pass preflight', async t => {
  for (const change of [
    { GITHUB_REF_TYPE: 'branch', GITHUB_REF: 'refs/heads/main' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/tags/different-tag' },
    { PREVIEW_EXPECTED_SHA: 'main' },
    { GITHUB_SHA: 'b'.repeat(40) },
    { PREVIEW_RELEASE_TAG: '../main' },
  ]) await t.test(Object.keys(change).join('+'), async () => {
    await assert.rejects(preflightPreview({ env: { ...env, ...change }, head: sha, github: githubFixture() }));
  });
  await assert.rejects(preflightPreview({ env, head: 'b'.repeat(40), github: githubFixture() }), { code: 'SOURCE_MISMATCH' });
});

test('remote tag movement, published releases, and branch-based release targets are rejected', async t => {
  const releasePath = `repos/${repository}/releases?per_page=100`;
  for (const change of [{ draft: false }, { prerelease: false }, { target_commitish: 'main' },
    { target_commitish: 'b'.repeat(40) }, { tag_name: 'different-tag' }]) {
    await t.test(Object.keys(change).join('+'), async () => {
      const github = githubFixture({ [releasePath]: [{
        id: 42, tag_name: tag, draft: true, prerelease: true, target_commitish: sha, assets: [], ...change,
      }] });
      await assert.rejects(preflightPreview({ env, head: sha, github }), { code: 'DRAFT_PREVIEW_REQUIRED' });
    });
  }
  const github = githubFixture({
    [`repos/${repository}/git/ref/tags/${tag}`]: { object: { type: 'commit', sha: 'b'.repeat(40) } },
  });
  await assert.rejects(preflightPreview({ env, head: sha, github }), { code: 'REMOTE_TAG_MISMATCH' });
});

test('a matching CI result from another repository or a missing native job is insufficient', async () => {
  const github = githubFixture({
    [`repos/${repository}/actions/workflows/local-agent.yml/runs?head_sha=${sha}&status=success&per_page=100`]: {
      workflow_runs: [{ id: 100, event: 'workflow_dispatch', path: '.github/workflows/local-agent.yml', head_sha: sha,
        head_repository: { full_name: 'other/research' }, status: 'completed', conclusion: 'success' }],
    },
  });
  await assert.rejects(preflightPreview({ env, head: sha, github }), { code: 'SUCCESSFUL_VALIDATION_REQUIRED' });
  const missing = githubFixture({
    [`repos/${repository}/actions/runs/100/jobs?filter=latest&per_page=100`]: {
      total_count: names.length - 1, jobs: names.slice(0, -1).map(name => ({ name, status: 'completed', conclusion: 'success' })),
    },
  });
  await assert.rejects(preflightPreview({ env, head: sha, github: missing }), { code: 'SUCCESSFUL_VALIDATION_REQUIRED' });
});

async function packageFixture(t, platform = 'mac', architecture = 'arm64') {
  const root = await mkdtemp(join(tmpdir(), 'ai-bridge-preview-test-'));
  t.after(async () => {
    assert.ok(basename(root).startsWith('ai-bridge-preview-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const os = platform === 'mac' ? 'macos' : 'linux';
  const extension = platform === 'mac' ? 'dmg' : 'deb';
  const filename = platform === 'linux' ? 'hapark-connector-0.1.1-linux-amd64.deb'
    : `hapark-connector-0.1.1-${platform}-${architecture}.${extension}`;
  const bytes = Buffer.from('verified native installer fixture');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const dist = join(root, 'connector', 'dist');
  const installedPath = join(root, 'connector', 'artifacts', `ci-installed-${os}`, 'result.json');
  const nativePath = join(root, 'connector', 'artifacts', `ci-desktop-smoke-${os}`, 'result.json');
  for (const path of [dist, join(root, 'connector', 'desktop'),
    join(root, 'connector', 'artifacts', `ci-installed-${os}`),
    join(root, 'connector', 'artifacts', `ci-desktop-smoke-${os}`)]) await mkdir(path, { recursive: true });
  await writeFile(join(root, 'connector', 'desktop', 'package.json'), JSON.stringify({ version: '0.1.1' }));
  await writeFile(join(dist, filename), bytes);
  if (platform === 'mac') await writeFile(join(dist, `hapark-connector-0.1.1-mac-${architecture === 'arm64' ? 'x64' : 'arm64'}.dmg`), 'unverified cross-build');
  const installed = {
    passed: true, phase: 'completed', source: sha, platform: os, architecture, packageVersion: '0.1.1',
    mode: 'installed-unsigned-package-and-os-uri', cliInferenceRequested: false,
    checks: Array.from({ length: platform === 'mac' ? 9 : 8 }, (_, i) => `installed check ${i}`),
    cleanup: platform === 'mac' ? { ownedTempRemoved: true, macos: {
      processesStopped: true, protocolUnregistered: true, applicationRemoved: true,
      profileRemoved: true, mountDetached: true, errors: [],
    } } : { linuxOwnedProcessesStopped: true, linuxPackagePurged: true, linuxAppArmorProfileUnloaded: true,
      linuxFreshProfilesRemoved: true, linuxUriOpenersStopped: true, ownedTempRemoved: true },
    ...(platform === 'mac' ? { macos: { architecture, dmg: { filename, sha256: hash, bytes: bytes.length } } }
      : { linux: { architecture: 'amd64', packageSha256: hash } }),
    diagnostic: 'receipt-private-field-must-not-be-published',
  };
  const native = {
    passed: true, stage: 'complete', platform: os, architecture,
    mode: 'real-electron-real-os-encryption-mock-api', build: 'unpackaged-ci',
    mockKeychain: false, basicTextAllowed: false, cliInferenceJobsOffered: 0,
    checks: Array.from({ length: 13 }, (_, i) => `native check ${i}`),
    cleanup: { allOwnedAppsExited: true, loopbackClosed: true },
  };
  await writeFile(installedPath, JSON.stringify(installed));
  await writeFile(nativePath, JSON.stringify(native));
  return { root, installedPath, nativePath, installed, native, bytes, hash,
    env: { ...env, GITHUB_ACTIONS: 'true', CI: 'true', GITHUB_RUN_ID: '101', GITHUB_WORKSPACE: root,
      PREVIEW_PLATFORM: platform, PREVIEW_ARCHITECTURE: architecture },
    runtime: { platform: platform === 'mac' ? 'darwin' : 'linux', architecture },
  };
}

test('only the native-architecture verified package and curated metadata reach the upload boundary', async t => {
  const fixture = await packageFixture(t);
  const uploads = [];
  const metadata = await uploadPreview({ ...fixture, head: sha, github: githubFixture(),
    upload: async value => uploads.push(value) });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].tag, tag);
  assert.equal(uploads[0].repository, repository);
  assert.deepEqual(uploads[0].files.map(file => basename(file)), [
    'AI-Bridge-0.1.1-mac-arm64.dmg', 'AI-Bridge-0.1.1-mac-arm64.dmg.json',
  ]);
  assert.deepEqual(await readFile(uploads[0].files[0]), fixture.bytes);
  assert.equal(metadata.source, sha);
  assert.equal(metadata.architecture, 'arm64');
  assert.equal(metadata.sha256, fixture.hash);
  assert.equal(metadata.unsigned, true);
  assert.equal(metadata.validationRunId, 100);
  assert.equal(metadata.runId, 101);
  const published = await readFile(uploads[0].files[1], 'utf8');
  assert.deepEqual(JSON.parse(published), metadata);
  assert.ok(!published.includes('receipt-private-field') && !published.includes(fixture.root));
});

test('a remote tag moved after preflight still blocks the upload mutation', async t => {
  const fixture = await packageFixture(t);
  const api = githubFixture();
  let tagReads = 0;
  let uploads = 0;
  const github = async path => {
    if (path.endsWith(`/git/ref/tags/${tag}`) && ++tagReads > 1) return { object: { type: 'commit', sha: 'b'.repeat(40) } };
    return api(path);
  };
  await assert.rejects(uploadPreview({ ...fixture, head: sha, github,
    upload: async () => { uploads += 1; } }), { code: 'REMOTE_TAG_MISMATCH' });
  assert.equal(uploads, 0);
});

test('Ubuntu publishes only its own verified installer', async t => {
  for (const [platform, architecture, name] of [
    ['linux', 'x64', 'AI-Bridge-0.1.1-linux-x64.deb'],
  ]) await t.test(`${platform}-${architecture}`, async child => {
    const fixture = await packageFixture(child, platform, architecture);
    const uploads = [];
    const metadata = await uploadPreview({ ...fixture, head: sha, github: githubFixture(), upload: async value => uploads.push(value) });
    assert.equal(uploads.length, 1);
    assert.equal(basename(uploads[0].files[0]), name);
    assert.deepEqual(await readFile(uploads[0].files[0]), fixture.bytes);
    assert.equal(metadata.architecture, architecture);
    assert.equal(metadata.sha256, fixture.hash);
  });
});

test('the actual amd64 Debian input must still match the installed receipt hash before upload', async t => {
  const fixture = await packageFixture(t, 'linux', 'x64');
  await writeFile(join(fixture.root, 'connector', 'dist', 'hapark-connector-0.1.1-linux-amd64.deb'),
    Buffer.alloc(fixture.bytes.length, 0x78));
  let uploads = 0;
  await assert.rejects(uploadPreview({ ...fixture, head: sha, github: githubFixture(),
    upload: async () => { uploads += 1; } }), { code: 'PACKAGE_HASH_MISMATCH' });
  assert.equal(uploads, 0);
});

test('failed, stale-source, wrong-architecture and unclean installation receipts never reach upload', async t => {
  for (const [label, change] of [
    ['failed', { passed: false }], ['stale source', { source: 'b'.repeat(40) }],
    ['wrong architecture', { architecture: 'x64' }], ['wrong version', { packageVersion: '0.1.0' }],
    ['incomplete cleanup', { cleanup: { ownedTempRemoved: false } }],
  ]) await t.test(label, async child => {
    const fixture = await packageFixture(child);
    await writeFile(fixture.installedPath, JSON.stringify({ ...fixture.installed, ...change }));
    let uploads = 0;
    await assert.rejects(uploadPreview({ ...fixture, head: sha, github: githubFixture(),
      upload: async () => { uploads += 1; } }));
    assert.equal(uploads, 0);
  });
});

test('a changed package or a plaintext-keychain native receipt cannot be uploaded', async t => {
  for (const mode of ['package changed', 'plaintext keychain']) await t.test(mode, async child => {
    const fixture = await packageFixture(child);
    if (mode === 'package changed') await writeFile(join(fixture.root, 'connector', 'dist', 'hapark-connector-0.1.1-mac-arm64.dmg'), 'X'.repeat(fixture.bytes.length));
    else await writeFile(fixture.nativePath, JSON.stringify({ ...fixture.native, basicTextAllowed: true }));
    let uploads = 0;
    await assert.rejects(uploadPreview({ ...fixture, head: sha, github: githubFixture(),
      upload: async () => { uploads += 1; } }), { code: mode === 'package changed' ? 'PACKAGE_HASH_MISMATCH' : 'NATIVE_RECEIPT_MISMATCH' });
    assert.equal(uploads, 0);
  });
});

test('existing asset names fail rather than being replaced, and public releases are never modified', async t => {
  for (const change of [
    { assets: [{ name: 'AI-Bridge-0.1.1-mac-arm64.dmg' }] },
    { assets: [{ name: 'AI-Bridge-0.1.1-mac-arm64.dmg.json' }] },
    { draft: false },
  ]) await t.test(JSON.stringify(change), async child => {
    const fixture = await packageFixture(child);
    const api = githubFixture();
    let releaseReads = 0;
    let uploads = 0;
    const github = async path => {
      const result = await api(path);
      if (path === `repos/${repository}/releases?per_page=100` && ++releaseReads > 1) return result.map(release => ({ ...release, ...change }));
      return result;
    };
    await assert.rejects(uploadPreview({ ...fixture, head: sha, github, upload: async () => { uploads += 1; } }));
    assert.equal(uploads, 0);
  });
});

test('the executable upload command refuses a local invocation before any GitHub operation', () => {
  const script = fileURLToPath(new URL('../scripts/preview-release.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'upload'], { windowsHide: true, encoding: 'utf8',
    env: { ...process.env, CI: 'false', GITHUB_ACTIONS: 'false' }, timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { passed: false, code: 'ACTIONS_UPLOAD_REQUIRED' });
});
