import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInside } from '../scripts/installed-smoke-support.mjs';

// Execute the real entry's startup with only Electron replaced; no Electron app, CLI or browser starts.
const bootstrap = String.raw`
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const fixture = JSON.parse(process.env.CONNECTOR_PROFILE_FIXTURE);
let directory = join(fixture.appData, 'AI 브릿지'), name = 'AI 브릿지';
const events = [];
globalThis.__connectorProfileApp = {
  isPackaged: fixture.packaged, on() {}, getVersion() { return '0.1.5'; },
  getPath(key) { return key === 'appData' ? fixture.appData : directory; },
  setName(value) { name = value; events.push('name'); },
  setPath(key, value) { if (key !== 'userData' || !existsSync(value)) throw new Error('Profile must exist before setPath'); directory = value; events.push('path'); },
  requestSingleInstanceLock() { events.push('lock'); return false; }, quit() { events.push('quit'); },
};
const electron = 'export const app=globalThis.__connectorProfileApp; export const BrowserWindow=undefined,ipcMain={},nativeTheme={},safeStorage={},shell={},screen={};';
registerHooks({ resolve(specifier, context, next) { return specifier === 'electron'
  ? { url: 'data:text/javascript,' + encodeURIComponent(electron), shortCircuit: true } : next(specifier, context); } });
Object.defineProperty(process, 'resourcesPath', { value: join(fixture.root, 'connector'), configurable: true });
if (fixture.override) process.argv.push('--connector-data-dir=' + fixture.override);
await import(pathToFileURL(join(fixture.root, 'connector/desktop/main.mjs')).href);
console.log(JSON.stringify({ directory, name, events }));
`;

function startup(options) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], { input: bootstrap,
    env: { ...process.env, CONNECTOR_PROFILE_FIXTURE: JSON.stringify({ root, ...options }) },
    windowsHide: true, shell: false, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, 'The real entry must finish its isolated startup without starting Electron.');
  return JSON.parse(result.stdout.trim());
}

test('a renamed packaged app retains the prior ciphertext path and internal encryption identity before locking', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'connector-profile-existing-'));
  try {
    const legacy = join(owned, '하박조팽 연결기'); await mkdir(legacy);
    const cipher = Buffer.from('opaque prior encrypted device envelope fixture');
    await writeFile(join(legacy, 'devices.enc.json'), cipher);
    const override = join(owned, 'ignored-packaged-override');
    const value = startup({ appData: owned, packaged: true, override });
    assert.equal(value.directory, legacy);
    assert.equal(value.name, '하박조팽 연결기');
    assert.ok(value.events.indexOf('path') < value.events.indexOf('lock'));
    assert.deepEqual(await readFile(join(legacy, 'devices.enc.json')), cipher);
    await assert.rejects(access(join(owned, 'AI 브릿지')));
    await assert.rejects(access(override));
  } finally { assertInside(owned, tmpdir()); await rm(owned, { recursive: true }); }
});

test('fresh legacy profiles and explicit unpackaged QA directories exist before Electron selects them', async () => {
  const owned = await mkdtemp(join(tmpdir(), 'connector-profile-fresh-'));
  try {
    for (const packaged of [true, false]) {
      const appData = join(owned, String(packaged)); await mkdir(appData);
      const override = packaged ? undefined : join(owned, 'isolated-qa');
      const expected = override ?? join(appData, '하박조팽 연결기');
      const value = startup({ appData, packaged, override });
      assert.equal(value.directory, expected);
      assert.equal(value.name, '하박조팽 연결기');
      await access(expected);
      assert.ok(value.events.indexOf('path') < value.events.indexOf('lock'));
    }
  } finally { assertInside(owned, tmpdir()); await rm(owned, { recursive: true }); }
});
