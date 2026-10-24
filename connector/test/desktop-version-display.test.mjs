import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('native settings show the current IPC version and update when the reported state changes', async () => {
  const html = await readFile(new URL('../desktop/renderer/index.html', import.meta.url), 'utf8');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', textContent: '', dataset: {}, listeners: {}, attributes: {}, addEventListener(name, listener) { this.listeners[name] = listener; }, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute() {},
    replaceChildren() {}, focus() { globalThis.document.activeElement = this; },
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
    stateListener({ ...state, stage: 'connected', briMode: 'working' });
    assert.equal(elements.get('status').textContent, '연결됨');
    stateListener({ ...state, stage: 'connected', briMode: 'recovering', connectionStatus: 'recovering' });
    assert.equal(elements.get('status').textContent, '연결 확인 중');
    await new Promise(resolve => queueMicrotask(resolve));
    elements.get('settings-tab').listeners.click();
    assert.equal(elements.get('settings-view').hidden, false);
    const focused = globalThis.document.activeElement;
    stateListener({ ...state, stage: 'connected', connectionStatus: 'connected', activity: { kind: 'running', provider: 'claude', requestedModel: 'requested-alias' } });
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(globalThis.document.activeElement, focused);
    assert.equal(elements.get('activity-label').textContent, 'Claude Code CLI 실행 중');
    assert.equal(elements.get('activity-model').textContent, '요청 모델 requested-alias');
    stateListener({ ...state, stage: 'pairing', attemptId: 'fresh-attempt' });
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(elements.get('connection-view').hidden, false);
    assert.equal(elements.get('settings-view').hidden, true);
    assert.equal(globalThis.document.activeElement, elements.get('code'));
    stateListener({ ...state, stage: 'connected', closeToTray: false });
    assert.ok(elements.get('lifetime-note').textContent.includes('연결도 종료'));
    stateListener({ ...state, stage: 'connected', closeToTray: true });
    assert.ok(elements.get('lifetime-note').textContent.includes('트레이에서 연결'));
    await new Promise(resolve => queueMicrotask(resolve));
  } finally { globalThis.document = priorDocument; globalThis.window = priorWindow; }
});
