import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('native settings show the current IPC version and update when the reported state changes', async () => {
  const html = await readFile(new URL('../desktop/renderer/index.html', import.meta.url), 'utf8');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', textContent: '', dataset: {}, addEventListener() {}, setAttribute() {}, removeAttribute() {},
    replaceChildren() {}, focus() {},
  }]));
  const priorDocument = globalThis.document, priorWindow = globalThis.window;
  let stateListener;
  const state = { stage: 'idle', appName: 'AI 브릿지', providers: [], bridgeVersion: '9.8.7-native.2+fixture' };
  try {
    globalThis.document = { getElementById: id => elements.get(id), addEventListener() {} };
    globalThis.window = { connector: { onState(listener) { stateListener = listener; }, state: async () => state } };
    await import('../desktop/renderer/app.js');
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(elements.get('bridge-version')?.textContent, '버전 9.8.7-native.2+fixture');
    stateListener({ ...state, bridgeVersion: '0.1.5' });
    assert.equal(elements.get('bridge-version').textContent, '버전 0.1.5');
    stateListener({ ...state, bridgeVersion: undefined });
    assert.equal(elements.get('bridge-version').textContent, '버전 정보 없음');
    await new Promise(resolve => queueMicrotask(resolve));
  } finally { globalThis.document = priorDocument; globalThis.window = priorWindow; }
});
