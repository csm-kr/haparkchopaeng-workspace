import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrigin, parseLaunchUrl, createDeviceIdentity, providerEnvironment } from '../core/security.mjs';
import { createApiClient } from '../core/api.mjs';

const apps = [{ id: 'hapark', scheme: 'hapark-connect', origin: 'https://research.example', name: '하박조팽' }];
const token = 'a'.repeat(43);
const uri = `hapark-connect://connect?attemptId=attempt-1&launchToken=${token}`;

test('protocol accepts only registered app and exact bounded parameters', () => {
  assert.deepEqual(parseLaunchUrl(uri, apps), { application: apps[0], attemptId: 'attempt-1', launchToken: token });
  for (const bad of [uri + '&origin=https://evil.example', uri + '&attemptId=other', uri.replace('connect?', 'connect/path?'), uri.replace('hapark-connect:', 'evil:'), uri.replace('attempt-1', '../secret'), uri.replace(token, 'short')]) {
    assert.throws(() => parseLaunchUrl(bad, apps));
  }
});

test('the root slash inserted by Windows preserves a valid registered connection link', () => {
  const windowsUri = uri.replace('connect?', 'connect/?');
  assert.deepEqual(parseLaunchUrl(windowsUri, apps), parseLaunchUrl(uri, apps));
});

test('Windows root slash does not admit other paths, authorities or unvalidated parameters', () => {
  const windowsUri = uri.replace('connect?', 'connect/?');
  for (const bad of [
    windowsUri.replace('connect/?', 'connect/path?'),
    windowsUri.replace('connect/?', 'connect//?'),
    windowsUri.replace('connect/?', 'connect/%2F?'),
    windowsUri.replace('connect/?', 'other/?'),
    windowsUri.replace('connect/?', 'user@connect/?'),
    windowsUri.replace('connect/?', 'connect:443/?'),
    windowsUri + '#fragment',
    windowsUri + '&origin=https://other.example',
    windowsUri + '&attemptId=duplicate',
    windowsUri.replace(token, 'short'),
    windowsUri.replace('attempt-1', '../private'),
  ]) assert.throws(() => parseLaunchUrl(bad, apps));
});

test('origin rejects credentials, redirects, remote HTTP, URL paths and opaque protocols', async () => {
  assert.equal(normalizeOrigin('https://research.example/'), 'https://research.example');
  assert.equal(normalizeOrigin('http://localhost:3000', { development: true }), 'http://localhost:3000');
  for (const value of ['http://research.example', 'https://user:pass@research.example', 'https://research.example/path', 'https://research.example?x=1', 'file:///tmp/a', 'http://localhost.evil.example']) assert.throws(() => normalizeOrigin(value));
  assert.throws(() => createApiClient({ origin: 'https://evil.example', allowedOrigins: ['https://research.example'], fetchImpl: () => {} }));
  let captured;
  const api = createApiClient({ origin: apps[0].origin, allowedOrigins: [apps[0].origin], fetchImpl: async (url, options) => { captured = { url, options }; return { ok: true, status: 200, json: async () => ({ data: { ok: true } }) }; } });
  assert.deepEqual(await api.post('heartbeat', { providers: [] }, { deviceId: 'device-1', deviceToken: token }), { ok: true });
  assert.equal(captured.url, 'https://research.example/api/local-agent/desktop/heartbeat');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.credentials, 'omit');
  assert.equal(captured.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(captured.options.headers['X-Local-Agent-Device'], 'device-1');
  await assert.rejects(api.post('../arbitrary', {}));
});

test('device credentials are random and provider child environment drops conflicting keys', () => {
  const a = createDeviceIdentity('windows');
  const b = createDeviceIdentity('windows');
  assert.match(a.deviceToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.deviceToken, b.deviceToken);
  const env = providerEnvironment({ PATH: 'safe', OPENAI_API_KEY: 'private', ANTHROPIC_API_KEY: 'private', ANTHROPIC_BASE_URL: 'https://wrong.example', CLAUDECODE: 'nested', ELECTRON_RUN_AS_NODE: '0' });
  assert.equal(env.PATH, 'safe');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.CLAUDECODE, undefined);
});

test('API surfaces safe status without reflecting response bodies or credentials', async () => {
  const api = createApiClient({ origin: apps[0].origin, allowedOrigins: [apps[0].origin], fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 'PRIVATE', message: 'secret-token-123' } }) }) });
  await assert.rejects(api.post('claim', {}), error => error.status === 401 && !error.message.includes('secret-token'));
});

test('pairing errors use clear fixed messages for wrong and expired numbers', async () => {
  for (const [status, code, expected] of [[400, 'WRONG_CODE', /번호가 맞지/], [410, 'PAIRING_EXPIRED', /새 번호/]]) {
    const api = createApiClient({ origin: apps[0].origin, allowedOrigins: [apps[0].origin], fetchImpl: async () => ({ ok: false, status, json: async () => ({ error: { code, message: 'do-not-reflect-private-data' } }) }) });
    await assert.rejects(api.post('pair', {}), error => expected.test(error.message) && !error.message.includes('private'));
  }
});
