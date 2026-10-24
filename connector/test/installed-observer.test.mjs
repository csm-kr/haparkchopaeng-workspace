import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { connectInstalledApp } from '../scripts/installed-smoke-support.mjs';
import { assertLinuxRejectedState } from '../scripts/ci-installed-linux.mjs';
import { assertMacRejectedState } from '../scripts/ci-installed-macos.mjs';
import { assertWindowsRejectedState } from '../scripts/installed-windows-support.mjs';

const description = '등록된 앱의 연결 링크를 사용해 주세요.';
const rejectedState = {
  stage: 'error', title: '연결 확인', description, attemptId: null,
  providers: [{ provider: 'codex', status: 'ready' }, { provider: 'claude', status: 'not_installed' }],
  connectionStatus: 'disconnected', webReady: false, activity: { kind: 'idle' }, autoStart: false, pet: false,
};
const validators = [assertLinuxRejectedState, assertMacRejectedState, assertWindowsRejectedState];

async function installedObserver(t) {
  const port = 18000, rendererFile = join(tmpdir(), 'installed-observer-fixture', 'index.html');
  let nativeState;
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, `http://127.0.0.1:${port}/json/list`);
    return { ok: true, status: 200, json: async () => [{ type: 'page', url: pathToFileURL(rendererFile).href,
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/fixture` }] };
  });
  t.mock.method(globalThis, 'WebSocket', function (url) {
    assert.equal(String(url), `ws://127.0.0.1:${port}/devtools/page/fixture`);
    const socket = new EventTarget();
    socket.send = raw => {
      const { id, method, params } = JSON.parse(raw);
      assert.equal(method, 'Runtime.evaluate');
      assert.equal(params.returnByValue, true);
      assert.equal(params.awaitPromise, true);
      const result = runInNewContext(params.expression, { window: { connector: { state: async () => nativeState } } });
      Promise.resolve(result).then(value => {
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result: { result: { value } } }) }));
      }, () => {
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result: { exceptionDetails: {} } }) }));
      });
    };
    socket.close = () => socket.dispatchEvent(new Event('close'));
    queueMicrotask(() => socket.dispatchEvent(new Event('open')));
    return socket;
  });
  const client = await connectInstalledApp(port, rendererFile);
  t.after(() => client.close());
  return async state => { nativeState = state; return client.state(); };
}

test('installed observer preserves rejection evidence and its public state whitelist through CDP', async t => {
  const observe = await installedObserver(t);
  const state = await observe({ ...rejectedState,
    providers: rejectedState.providers.map(provider => ({ ...provider, model: 'private-model', path: '/private/cli' })),
    activity: { kind: 'idle', provider: 'codex', model: 'private-model', jobId: 'private-job', prompt: 'private-prompt' },
    auth: 'private-auth', credentialPath: '/private/credentials',
  });
  assert.deepEqual(state, rejectedState);
  assert.equal(JSON.stringify(state).includes('private'), false);
  for (const validate of validators) assert.doesNotThrow(() => validate(state, description));
});

test('every installed rejection validator rejects unsafe states after the actual observer boundary', async t => {
  const observe = await installedObserver(t);
  for (const override of [
    { connectionStatus: 'connected' }, { connectionStatus: 'recovering' }, { webReady: true },
    { activity: { kind: 'running', provider: 'codex', jobId: 'private-job' } }, { activity: { kind: 'preparing' } },
    { stage: 'connected' }, { description: 'another error' }, { attemptId: 'unexpected' },
    { autoStart: true }, { pet: true },
  ]) {
    const state = await observe({ ...rejectedState, ...override });
    for (const [key, value] of Object.entries(override)) {
      assert.deepEqual(state[key], key === 'activity' ? { kind: value.kind } : value);
    }
    for (const validate of validators) assert.throws(() => validate(state, description), { code: 'ERR_ASSERTION' });
  }
});

test('missing installed rejection evidence stays missing and cannot pass any OS validator', async t => {
  const observe = await installedObserver(t);
  for (const key of ['connectionStatus', 'webReady', 'activity']) {
    const nativeState = { ...rejectedState };
    delete nativeState[key];
    const state = await observe(nativeState);
    assert.equal(Object.hasOwn(state, key), false);
    for (const validate of validators) assert.throws(() => validate(state, description), { code: 'ERR_ASSERTION' });
  }
  for (const activity of [null, {}]) {
    const state = await observe({ ...rejectedState, activity });
    assert.deepEqual(state.activity, activity);
    for (const validate of validators) assert.throws(() => validate(state, description), { code: 'ERR_ASSERTION' });
  }
});
