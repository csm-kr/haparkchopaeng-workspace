import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { legacyMacBundleName, macBundleId, retireLegacyMacBundles } from '../desktop/legacy-mac-bundle.mjs';

const home = '/Users/member';
const installed = '/Applications/AI Bridge.app/Contents/MacOS/AI Bridge';
const legacy = ['/Applications/hapark-connector.app', '/Users/member/Applications/hapark-connector.app'];
const directory = { isDirectory: () => true };

function fixture({ entries = Object.fromEntries(legacy.map(path => [path, { stat: directory, id: macBundleId }])), ...overrides } = {}) {
  const calls = [];
  const options = {
    platform: 'darwin', packaged: true, execPath: installed, home,
    lstat: async path => { if (!entries[path]) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return entries[path].stat; },
    readBundleId: async path => { calls.push(['read', path]); const id = entries[path].id; if (id instanceof Error) throw id; return id; },
    unregister: async path => { calls.push(['unregister', path]); },
    trash: async path => { calls.push(['trash', path]); if (entries[path].trashError) throw new Error('trash failed'); },
    ...overrides,
  };
  return { options, calls };
}

test('the renamed app installed in Applications unregisters and then trashes both pre-rename copies', async () => {
  const { options, calls } = fixture();
  assert.deepEqual(await retireLegacyMacBundles(options), legacy);
  assert.deepEqual(calls.filter(([kind]) => kind !== 'read'), legacy.flatMap(path => [['unregister', path], ['trash', path]]));
});

test('the user Applications folder is also an installed location', async () => {
  const { options } = fixture({ execPath: '/Users/member/Applications/AI Bridge.app/Contents/MacOS/AI Bridge' });
  assert.deepEqual(await retireLegacyMacBundles(options), legacy);
});

test('nothing is touched outside a packaged macOS app installed in an Applications folder', async () => {
  for (const override of [
    { platform: 'win32' }, { platform: 'linux' }, { packaged: false },
    // Running straight from the DMG or a translocated download must not leave the user without an installed app.
    { execPath: '/Volumes/AI Bridge 0.1.9/AI Bridge.app/Contents/MacOS/AI Bridge' },
    { execPath: '/private/var/folders/xy/T/AppTranslocation/1234/d/AI Bridge.app/Contents/MacOS/AI Bridge' },
    { execPath: '/Applications/Tools/AI Bridge.app/Contents/MacOS/AI Bridge' },
    { execPath: '/Applications/hapark-connector.app/Contents/MacOS/hapark-connector' },
    { execPath: '/usr/local/bin/node' },
  ]) {
    const { options, calls } = fixture(override);
    assert.deepEqual(await retireLegacyMacBundles(options), [], JSON.stringify(override));
    assert.deepEqual(calls, [], JSON.stringify(override));
  }
});

test('only a real directory carrying this app bundle ID is retired', async () => {
  const { options, calls } = fixture({ entries: {
    [legacy[0]]: { stat: { isDirectory: () => false }, id: macBundleId }, // lstat: a symlink or file is not a directory
    [legacy[1]]: { stat: directory, id: 'org.example.other' },
  } });
  assert.deepEqual(await retireLegacyMacBundles(options), []);
  assert.deepEqual(calls, [['read', legacy[1]]]);
});

test('a failure on one copy is contained and never blocks startup or the other copy', async () => {
  const unreadable = fixture({ entries: { [legacy[0]]: { stat: directory, id: new Error('plutil failed') }, [legacy[1]]: { stat: directory, id: macBundleId } } });
  assert.deepEqual(await retireLegacyMacBundles(unreadable.options), [legacy[1]]);
  const trashFails = fixture({ entries: { [legacy[0]]: { stat: directory, id: macBundleId, trashError: true }, [legacy[1]]: { stat: directory, id: macBundleId } } });
  assert.deepEqual(await retireLegacyMacBundles(trashFails.options), [legacy[1]]);
  const absent = fixture({ entries: {} });
  assert.deepEqual(await retireLegacyMacBundles(absent.options), []);
});

test('the retired identity matches the shipped bundle ID and the previous Mac bundle name', async () => {
  const source = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  assert.equal(macBundleId, source.build.appId);
  assert.equal(legacyMacBundleName, 'hapark-connector.app');
  assert.notEqual(`${source.build.mac.executableName}.app`, legacyMacBundleName);
  assert.ok(source.build.files.includes('legacy-mac-bundle.mjs'));
});

test('the desktop entry retires legacy copies before claiming the URL scheme, outside QA', async () => {
  const main = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
  const retire = main.indexOf('await retireLegacyMacBundles(');
  assert.ok(retire > 0);
  assert.ok(retire < main.indexOf('app.setAsDefaultProtocolClient('));
  assert.match(main.slice(main.lastIndexOf('\n', retire), retire), /if \(!quietQa\)/);
  assert.match(main, /trash: path => shell\.trashItem\(path\)/);
});
