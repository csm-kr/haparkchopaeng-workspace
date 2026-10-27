import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// The extended WebP header records canvas dimensions and whether alpha is present.
test('the packaged atlas keeps transparency and twelve equal full-body cells', async () => {
  const atlas = await readFile(new URL('../desktop/assets/bri/sprites-v2.webp', import.meta.url));
  assert.equal(atlas.toString('ascii', 0, 4), 'RIFF');
  assert.equal(atlas.toString('ascii', 8, 16), 'WEBPVP8X');
  assert.ok(atlas[20] & 0x10);
  assert.equal(atlas.readUIntLE(24, 3) + 1, 800);
  assert.equal(atlas.readUIntLE(27, 3) + 1, 720);
});

test('pet applies only known modes, avoids duplicate announcements and releases its listener', async () => {
  const previous = { document: globalThis.document, window: globalThis.window };
  let listener, onPageHide, stopped = false, changes = 0;
  const attributes = new Map();
  const character = { setAttribute(name, value) { attributes.set(name, value); changes++; }, addEventListener() {} };
  const status = { value: '', get textContent() { return this.value; }, set textContent(value) { this.value = value; changes++; } };
  const body = { dataset: new Proxy({}, { set(target, key, value) { target[key] = value; changes++; return true; } }) };
  try {
    globalThis.document = {
      body,
      querySelector(selector) { assert.equal(selector, '.bri'); return character; },
      getElementById(id) { assert.equal(id, 'pet-status'); return status; },
    };
    globalThis.window = {
      bri: { onState(callback) { listener = callback; return () => { stopped = true; }; } },
      addEventListener(name, callback, options) { assert.equal(name, 'pagehide'); assert.equal(options.once, true); onPageHide = callback; },
    };
    await import('../desktop/renderer/pet.js');
    listener('working');
    assert.equal(body.dataset.mode, 'working'); assert.equal(status.textContent, '일하는 중');
    assert.match(attributes.get('aria-label'), /일하는 브리/);
    const previousChanges = changes;
    listener('working'); listener('__proto__'); listener({ mode: 'error' });
    assert.equal(changes, previousChanges);
    listener('recovering'); assert.equal(status.textContent, '연결 확인 중');
    listener('disconnected'); assert.equal(body.dataset.mode, 'disconnected');
    onPageHide(); assert.equal(stopped, true);
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; }
});

test('a left click plays one short reaction, varies it on the next click and clears it on mode change', async () => {
  const previous = { document: globalThis.document, window: globalThis.window, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const { BRI_REACTIONS } = await import('../desktop/renderer/bri-state.mjs');
  let listener;
  const handlers = new Map(), signals = [];
  const timers = new Map(); let nextTimer = 0;
  const character = { offsetWidth: 88, setAttribute() {}, setPointerCapture() {}, addEventListener(name, callback) { handlers.set(name, callback); } };
  const body = { dataset: {} };
  const pointer = (type, clientX = 10, clientY = 10, button = 0) => handlers.get(type)({ type, button, pointerId: 1, clientX, clientY, preventDefault() { signals.push('prevented'); } });
  const click = () => { pointer('pointerdown'); pointer('pointerup'); };
  try {
    globalThis.setTimeout = (callback, ms) => { timers.set(++nextTimer, { callback, ms }); return nextTimer; };
    globalThis.clearTimeout = id => { timers.delete(id); };
    globalThis.document = { body, querySelector: () => character, getElementById: () => ({ textContent: '' }) };
    globalThis.window = { bri: { onState(callback) { listener = callback; return () => {}; },
      startDrag() { signals.push('start'); }, endDrag() { signals.push('end'); }, openApp() { signals.push('open'); } }, addEventListener() {} };
    await import('../desktop/renderer/pet.js?pointer');
    click();
    const first = body.dataset.reaction;
    assert.ok(BRI_REACTIONS.includes(first));
    click();
    assert.ok(BRI_REACTIONS.includes(body.dataset.reaction)); assert.notEqual(body.dataset.reaction, first);
    assert.equal(timers.size, 1, 'A new click replaces the pending reset.');
    const [{ callback, ms }] = timers.values();
    assert.ok(ms >= 800 && ms <= 1600); callback();
    assert.equal(body.dataset.reaction, undefined);
    click(); listener('working');
    assert.equal(body.dataset.reaction, undefined, 'A real status change ends the decorative reaction.');
    click(); assert.equal(body.dataset.reaction, 'boop');
    assert.deepEqual(signals, [], 'A click neither drags nor opens the app.');
  } finally { Object.assign(globalThis, previous); }
});

test('dragging anywhere on Bri moves the pet without a reaction, and a right click opens the app', async () => {
  const previous = { document: globalThis.document, window: globalThis.window };
  const handlers = new Map(), signals = [];
  const character = { offsetWidth: 88, setAttribute() {}, setPointerCapture(id) { signals.push(`capture:${id}`); }, addEventListener(name, callback) { handlers.set(name, callback); } };
  const body = { dataset: {} };
  const pointer = (type, clientX = 10, clientY = 10, button = 0) => handlers.get(type)({ type, button, pointerId: 7, clientX, clientY, screenX: 0, screenY: 0, preventDefault() { signals.push('prevented'); } });
  try {
    globalThis.document = { body, querySelector: () => character, getElementById: () => ({ textContent: '' }) };
    globalThis.window = { bri: { onState() { return () => {}; },
      startDrag(...args) { signals.push(['start', ...args]); }, endDrag(...args) { signals.push(['end', ...args]); }, openApp(...args) { signals.push(['open', ...args]); } }, addEventListener() {} };
    await import('../desktop/renderer/pet.js?drag');
    pointer('pointerdown', 10, 10); pointer('pointermove', 12, 11);
    assert.deepEqual(signals, ['capture:7'], 'A tiny wobble is still a click.');
    pointer('pointermove', 30, 40); pointer('pointermove', 60, 80);
    pointer('pointerup', 60, 80); pointer('lostpointercapture', 60, 80);
    assert.deepEqual(signals, ['capture:7', ['start'], ['end']]);
    assert.equal(body.dataset.reaction, undefined, 'A drag never plays a reaction.');
    signals.length = 0;
    pointer('pointerdown', 10, 10, 2); pointer('pointermove', 90, 90, 2); pointer('pointerup', 90, 90, 2);
    handlers.get('contextmenu')({ preventDefault() { signals.push('prevented'); } });
    assert.deepEqual(signals, ['prevented', ['open']], 'Only the left button drags; the right button opens the app.');
    assert.equal(body.dataset.reaction, undefined);
    pointer('pointerdown', 10, 10); pointer('pointermove', 50, 50); pointer('pointercancel', 50, 50);
    assert.deepEqual(signals.slice(-2), [['start'], ['end']], 'A cancelled drag still ends.');
  } finally { Object.assign(globalThis, previous); }
});
