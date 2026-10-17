import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertInside, loadConfiguration } from '../scripts/installed-smoke-support.mjs';

const source = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));

test('the product macOS package uses an ASCII bundle/executable while preserving its Korean display identity', () => {
  assert.equal(source.build.mac.executableName, 'hapark-connector');
  assert.equal(source.productName, '하박조팽 연결기');
  assert.equal(source.build.appId, 'kr.hapark.connector');
  assert.deepEqual(source.build.protocols.flatMap(value => value.schemes), ['hapark-connect']);
  assert.equal(source.build.mac.hardenedRuntime, true);
});

test('installed-package configuration separates the Mac bundle filename from its display name and existing profile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'connector-macos-packaging-'));
  try {
    const desktop = join(directory, 'desktop');
    await mkdir(desktop);
    await writeFile(join(desktop, 'package.json'), JSON.stringify(source), { flag: 'wx' });
    await writeFile(join(desktop, 'apps.generated.json'), JSON.stringify({
      development: false, applications: [{ scheme: 'hapark-connect' }],
    }), { flag: 'wx' });
    const config = await loadConfiguration(directory);
    assert.equal(config.macBundleName, 'hapark-connector');
    assert.equal(config.productName, '하박조팽 연결기');
    assert.equal(config.appId, 'kr.hapark.connector');
    assert.equal(config.scheme, 'hapark-connect');
    assert.deepEqual(config.profileRelativePath, []);
  } finally {
    assertInside(directory, tmpdir());
    await rm(directory, { recursive: true });
  }
});
