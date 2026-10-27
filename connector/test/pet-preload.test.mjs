import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('the pet receives only modes, replays the latest mode and releases subscriptions', async () => {
  const ipc = Object.assign(new EventEmitter(), { send() {} });
  let exposed;
  const source = await readFile(new URL('../desktop/pet-preload.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { require(name) {
    assert.equal(name, 'electron');
    return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'bri'); exposed = value; } } };
  } });
  assert.deepEqual(Object.keys(exposed), ['onState', 'startDrag', 'endDrag', 'openApp']);
  const electronEvent = { sender: 'must not escape' };
  ipc.emit('connector:pet-state', electronEvent, 'working');
  const values = [];
  const stop = exposed.onState((...args) => values.push(args));
  assert.deepEqual(values, [['working']]);
  ipc.emit('connector:pet-state', electronEvent, 'recovering');
  assert.deepEqual(values, [['working'], ['recovering']]);
  ipc.emit('connector:pet-state', electronEvent, { stage: 'connected', secret: 'must not escape' });
  assert.equal(values.length, 2);
  stop(); stop();
  ipc.emit('connector:pet-state', electronEvent, 'disconnected');
  assert.equal(values.length, 2);
  const late = [];
  exposed.onState(mode => late.push(mode));
  assert.deepEqual(late, ['disconnected']);
  assert.equal(ipc.listenerCount('connector:pet-state'), 1);
});

test('the pet sends only fixed payload-free drag and open-app signals', async () => {
  const sent = [];
  const ipc = Object.assign(new EventEmitter(), { send(...args) { sent.push(args); } });
  let exposed;
  const source = await readFile(new URL('../desktop/pet-preload.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_name, value) { exposed = value; } } }) });
  exposed.startDrag({ x: -9999, y: -9999 }); exposed.endDrag('anything'); exposed.openApp('https://attacker.test');
  assert.deepEqual(sent, [['connector:pet-drag-start'], ['connector:pet-drag-end'], ['connector:pet-open-app']]);
});

test('packaged desktop includes the read-only pet preload', async () => {
  const manifest = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.build.files.includes('pet-preload.cjs'));
});
