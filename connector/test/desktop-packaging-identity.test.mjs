import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { assertInside, loadConfiguration } from '../scripts/installed-smoke-support.mjs';

const source = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);

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
    if (source.scripts['package:mac'].includes('--config mac-builder.cjs')) {
      await writeFile(join(desktop, 'mac-builder.cjs'), await readFile(new URL('../desktop/mac-builder.cjs', import.meta.url)), { flag: 'wx' });
    }
    await writeFile(join(desktop, 'apps.generated.json'), JSON.stringify({
      development: false, applications: [{ scheme: 'hapark-connect' }],
    }), { flag: 'wx' });
    const config = await loadConfiguration(directory);
    assert.equal(config.macBundleName, 'hapark-connector');
    assert.equal(config.productName, '하박조팽 연결기');
    assert.equal(config.appId, 'kr.hapark.connector');
    assert.equal(config.scheme, 'hapark-connect');
    assert.equal(config.macInternalName, 'hapark-connector');
    assert.equal(config.macDisplayName, source.productName);
    assert.equal(config.runtimeProductName, source.productName);
    assert.deepEqual(config.profileRelativePath, []);
  } finally {
    assertInside(directory, tmpdir());
    await rm(directory, { recursive: true });
  }
});

test('only the Mac build command selects the full native naming override', () => {
  assert.match(source.scripts['package:mac'], /--config mac-builder\.cjs\b/);
  assert.doesNotMatch(source.scripts['package:win'], /mac-builder/);
  assert.doesNotMatch(source.scripts['package:linux'], /mac-builder/);
  const config = require('../desktop/mac-builder.cjs');
  assert.equal(config.productName, 'hapark-connector');
  assert.equal(config.mac.executableName, 'hapark-connector');
  assert.equal(config.mac.extendInfo.CFBundleDisplayName, source.productName);
  assert.equal(config.extraMetadata.productName, source.productName);
  assert.deepEqual(config.win, source.build.win);
  assert.deepEqual(config.linux, source.build.linux);
  assert.deepEqual(config.nsis, source.build.nsis);
  assert.equal(source.build.productName, undefined);
  assert.equal(source.productName, '하박조팽 연결기');
});
