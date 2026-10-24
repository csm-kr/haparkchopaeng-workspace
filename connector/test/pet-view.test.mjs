import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// The extended WebP header records canvas dimensions and whether alpha is present.
test('the packaged atlas keeps transparency and eight equal square cells', async () => {
  const atlas = await readFile(new URL('../desktop/assets/bri/sprites-v1.webp', import.meta.url));
  assert.equal(atlas.toString('ascii', 0, 4), 'RIFF');
  assert.equal(atlas.toString('ascii', 8, 16), 'WEBPVP8X');
  assert.ok(atlas[20] & 0x10);
  assert.equal(atlas.readUIntLE(24, 3) + 1, 704);
  assert.equal(atlas.readUIntLE(27, 3) + 1, 352);
});

test('pet applies only known modes, avoids duplicate announcements and releases its listener', async () => {
  const previous = { document: globalThis.document, window: globalThis.window };
  let listener, onPageHide, stopped = false, changes = 0;
  const attributes = new Map();
  const character = { setAttribute(name, value) { attributes.set(name, value); changes++; } };
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
