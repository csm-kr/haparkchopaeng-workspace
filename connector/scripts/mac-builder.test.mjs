// Exercises the installed electron-builder implementation against a synthetic Electron bundle, never launches it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertInside } from './installed-smoke-support.mjs';

const desktop = fileURLToPath(new URL('../desktop/', import.meta.url));
const packageFile = join(desktop, 'package.json');
const source = JSON.parse(await readFile(packageFile, 'utf8'));
const requireSource = createRequire(pathToFileURL(packageFile));
const builderArgument = process.argv.indexOf('--builder-root');
const builderRoot = builderArgument < 0 ? desktop : process.argv[builderArgument + 1];
assert.ok(typeof builderRoot === 'string' && isAbsolute(builderRoot));
const requireBuilder = createRequire(pathToFileURL(join(resolve(builderRoot), 'package.json')));
assert.equal(requireBuilder('app-builder-lib/package.json').version, source.devDependencies['electron-builder']);
requireBuilder('app-builder-lib'); // Initialize the public entry point before its circular internal packager modules.
const { AppInfo } = requireBuilder('app-builder-lib/out/appInfo.js');
const { MacPackager } = requireBuilder('app-builder-lib/out/macPackager.js');
const { createMacApp } = requireBuilder('app-builder-lib/out/electron/electronMac.js');
const { createTransformer } = requireBuilder('app-builder-lib/out/fileTransformer.js');
const { parsePlistFile, savePlistFile } = requireBuilder('app-builder-lib/out/util/plist.js');
const { validateConfiguration } = requireBuilder('app-builder-lib/out/util/config/config.js');
const selectsMacConfig = /--config mac-builder\.cjs\b/.test(source.scripts['package:mac']);
const config = selectsMacConfig ? requireSource('./mac-builder.cjs') : source.build;
const metadata = { ...source, ...config.extraMetadata };
const info = { config, metadata, devMetadata: source, framework: { distMacOsAppName: 'Electron.app', defaultAppIdPrefix: 'com.electron.' } };
const appInfo = new AppInfo(info, source.version, config.mac, true);

test('the actual Mac build command selects a schema-valid full Mac configuration', async () => {
  assert.equal(selectsMacConfig, true);
  await validateConfiguration(config);
});

test('actual builder AppInfo separates ASCII native names from the Korean runtime metadata', () => {
  assert.equal(appInfo.productName, 'hapark-connector');
  assert.equal(appInfo.sanitizedProductName, 'hapark-connector');
  assert.equal(appInfo.productFilename, 'hapark-connector');
  assert.equal(metadata.productName, source.productName);
  assert.equal(appInfo.id, source.build.appId);
});

test('actual Mac plist and Helper renaming preserve the display brand and a coherent ASCII Helper lookup', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'connector-builder-mac-'));
  try {
    assert.equal(basename(appInfo.productFilename), appInfo.productFilename);
    const original = join(owned, 'Electron.app'), contents = join(original, 'Contents');
    await mkdir(join(contents, 'MacOS'), { recursive: true });
    await mkdir(join(contents, 'Resources'));
    await writeFile(join(contents, 'MacOS', 'Electron'), 'synthetic fixture: never executed');
    await savePlistFile(join(contents, 'Info.plist'), { CFBundleName: 'Electron', CFBundleExecutable: 'Electron' });
    const suffixes = [' Helper', ' Helper (Renderer)', ' Helper (GPU)', ' Helper (Plugin)'];
    for (const suffix of suffixes) {
      const helper = join(contents, 'Frameworks', `Electron${suffix}.app`, 'Contents');
      await mkdir(join(helper, 'MacOS'), { recursive: true });
      await writeFile(join(helper, 'MacOS', `Electron${suffix}`), 'synthetic fixture: never executed');
      await savePlistFile(join(helper, 'Info.plist'), { CFBundleName: `Electron${suffix}`, CFBundleExecutable: `Electron${suffix}` });
    }
    const packager = { appInfo, config, info, platformSpecificBuildOptions: config.mac, fileAssociations: [],
      getIconPath: async () => null,
      applyCommonInfo(plist, path) { return MacPackager.prototype.applyCommonInfo.call(this, plist, path); } };
    await createMacApp(packager, owned, null, false);
    const installed = join(owned, `${appInfo.productFilename}.app`, 'Contents');
    const plist = await parsePlistFile(join(installed, 'Info.plist'));
    assert.equal(plist.CFBundleName, 'hapark-connector');
    assert.equal(plist.CFBundleDisplayName, source.productName);
    assert.equal(plist.CFBundleExecutable, 'hapark-connector');
    const helperNames = await readdir(join(installed, 'Frameworks'));
    assert.deepEqual(helperNames.sort(), suffixes.map(suffix => `hapark-connector${suffix}.app`).sort());
    for (const suffix of suffixes) {
      const helper = join(installed, 'Frameworks', `hapark-connector${suffix}.app`, 'Contents');
      assert.equal((await parsePlistFile(join(helper, 'Info.plist'))).CFBundleExecutable, `hapark-connector${suffix}`);
      assert.equal(await readFile(join(helper, 'MacOS', `hapark-connector${suffix}`), 'utf8'), 'synthetic fixture: never executed');
    }
  } finally { assertInside(owned, tmpdir()); await rm(owned, { recursive: true }); }
});

test('the actual package transformer retains the original runtime product name', async () => {
  const transformed = await createTransformer(desktop, config, config.extraMetadata)(packageFile);
  const packaged = JSON.parse(transformed);
  assert.equal(packaged.productName, 'AI 브릿지');
  assert.equal(packaged.stableProfileName, '하박조팽 연결기');
  assert.equal(packaged.name, source.name);
  assert.equal(packaged.version, source.version);
  const owned = await mkdtemp(join(tmpdir(), 'connector-builder-asar-'));
  try {
    const input = join(owned, 'input'); await mkdir(input);
    await writeFile(join(input, 'package.json'), transformed);
    const asar = await import(pathToFileURL(requireBuilder.resolve('@electron/asar')).href);
    await asar.createPackage(input, join(owned, 'app.asar'));
    const extracted = JSON.parse(asar.extractFile(join(owned, 'app.asar'), 'package.json').toString('utf8'));
    assert.equal(extracted.productName, source.productName);
    assert.equal(extracted.name, source.name);
    assert.equal(extracted.version, source.version);
    assert.equal(extracted.stableProfileName, source.stableProfileName);
  } finally { assertInside(owned, tmpdir()); await rm(owned, { recursive: true }); }
});

test('Mac overrides leave the Windows and Linux build configurations and identities unchanged', () => {
  assert.deepEqual(config.win, source.build.win);
  assert.deepEqual(config.linux, source.build.linux);
  assert.deepEqual(config.nsis, source.build.nsis);
  assert.equal(source.build.productName, undefined);
  for (const platform of ['win', 'linux']) {
    assert.equal(new AppInfo({ ...info, config: source.build }, source.version, source.build[platform]).productName, source.productName);
  }
});
