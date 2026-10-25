import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectorSession } from '../core/runtime.mjs';

test('heartbeats report only explicitly supplied bridge version and architecture, preserving legacy callers', async () => {
  for (const options of [{}, { bridgeVersion: '0.1.5', bridgeArchitecture: 'x64' }, { bridgeVersion: '1.2.3-preview.1+build.7' }]) {
    const requests = [];
    const api = { post: async (route, body) => {
      requests.push({ route, body });
      return route === 'heartbeat' ? { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [] } : null;
    } };
    const session = new ConnectorSession({ api, identity: {}, adapters: {}, now: () => 1000,
      setIntervalFn: () => 1, clearIntervalFn() {}, ...options });
    session.start(new Date(46000).toISOString());
    try {
      await session.tick();
      assert.deepEqual(requests.find(value => value.route === 'heartbeat').body, { providers: [], ...options });
    } finally { session.stop(); }
  }
});

test('invalid explicit bridge metadata fails before any request', () => {
  for (const metadata of [{ bridgeVersion: null }, { bridgeVersion: 'latest' }, { bridgeVersion: '01.1.5' },
    { bridgeVersion: '1.2.3-' }, { bridgeVersion: '1.2.3+bad/value' }, { bridgeVersion: '1.2.3\n' }, { bridgeVersion: '1.2.3-01' }, { bridgeVersion: '1.2.3-' + 'x'.repeat(64) },
    { bridgeArchitecture: null }, { bridgeArchitecture: 'ia32' }]) {
    assert.throws(() => new ConnectorSession({ ...metadata, api: { post() { assert.fail('No request before validation'); } } }),
      /bridge/i);
  }
});

const identity = { deviceId: 'device-1', deviceToken: 'a'.repeat(43), deviceName: 'This PC', platform: 'windows' };
const providers = [{ provider: 'codex', status: 'ready', models: [{ id: 'model', name: 'Model' }], quota: null, observedAt: new Date(1000).toISOString() }];
const claim = { job: { id: 'job-1', provider: 'codex', model: 'model', prompt: '2+2', status: 'running' }, context: 'selected paper only', claimToken: 'claim-secret', leaseExpiresAt: new Date(46000).toISOString() };

test('session claims one job, streams accumulated sequenced answers and does not expose credentials', async () => {
  const calls = []; let claimed = false;
  const api = { post: async (path, body) => { calls.push({ path, body }); if (path === 'heartbeat') return { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [], heartbeatIntervalSeconds: 5 }; if (path === 'claim') return claimed ? null : (claimed = true, claim); return { accepted: true }; } };
  const session = new ConnectorSession({ api, identity, now: () => 1000, setIntervalFn: () => 1, clearIntervalFn: () => {}, adapters: { codex: { run: async ({ onText }) => { onText('4'); } } } });
  session.setProviders(providers);
  session.start(new Date(46000).toISOString());
  await session.tick();
  await session.whenIdle();
  const results = calls.filter(c => c.path === 'result');
  assert.ok(results.length >= 1);
  assert.equal(results.at(-1).body.status, 'completed');
  assert.equal(results.at(-1).body.response, '4');
  assert.ok(results.every((x, i) => !i || x.body.sequence > results[i - 1].body.sequence));
  assert.equal(JSON.stringify(session.getState()).includes('claim-secret'), false);
  assert.equal(JSON.stringify(session.getState()).includes(identity.deviceToken), false);
  session.stop();
});

test('expired web lease and server 401 abort running CLI immediately and stop future claims', async () => {
  for (const unauthorized of [false, true]) {
    let now = 1000, aborted = false, denied = false, claimCount = 0;
    const api = { post: async (path) => { if (path === 'heartbeat') { if (denied) throw Object.assign(new Error('Unauthorized'), { status: 401 }); if (now >= 46000) throw Object.assign(new Error('Expired'), { status: 403, code: 'WEB_PERMISSION_EXPIRED' }); return { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [], heartbeatIntervalSeconds: 5 }; } if (path === 'claim') { claimCount += 1; return claim; } return {}; } };
    const session = new ConnectorSession({ api, identity, now: () => now, setIntervalFn: () => 1, clearIntervalFn: () => {}, adapters: { codex: { run: async ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true })) } } });
    session.setProviders(providers); session.start(new Date(46000).toISOString());
    await session.tick();
    now = unauthorized ? 7000 : 47000; denied = unauthorized;
    await session.tick(); await session.whenIdle();
    assert.equal(aborted, true);
    // A lapsed web lease waits for the web to renew; a revoked device credential is final.
    assert.equal(session.getState().status, unauthorized ? 'authorization_required' : 'recovering');
    now += 5000; await session.tick();
    assert.equal(claimCount, 1);
    session.stop();
  }
});

test('a late web renewal resumes the same session without pairing again', async () => {
  let now = 1000, lease = 46000, claims = 0;
  const api = { post: async (path) => {
    if (path === 'heartbeat') {
      if (now >= lease) throw Object.assign(new Error('Expired'), { status: 403, code: 'WEB_PERMISSION_EXPIRED' });
      return { leaseExpiresAt: new Date(Math.min(lease, now + 45000)).toISOString(), cancelJobIds: [] };
    }
    if (path === 'claim') { claims += 1; return null; }
    return {};
  } };
  const states = [];
  const session = new ConnectorSession({ api, identity, now: () => now, setIntervalFn: () => 1, clearIntervalFn() {}, adapters: {} });
  session.on('state', value => states.push(value.status));
  session.start(new Date(lease).toISOString());
  await session.tick();
  assert.equal(claims, 1);
  // The hidden tab missed its renewal; the server refuses until the web renews.
  now = 50000; await session.tick();
  assert.equal(session.getState().status, 'recovering');
  assert.equal(claims, 1);
  now = 55000; await session.tick();
  assert.equal(session.getState().status, 'recovering');
  assert.equal(claims, 1);
  lease = 180000; now = 60000; await session.tick();
  assert.equal(session.getState().status, 'connected');
  assert.equal(session.getState().message, '');
  assert.equal(claims, 2);
  assert.equal(states.includes('authorization_required'), false);
  session.stop();
});

test('a local lease lapse without any server reply also waits instead of ending the session', async () => {
  let now = 1000, offline = false;
  const api = { post: async (path) => {
    if (offline) throw Object.assign(new Error('Network down'), { status: undefined });
    return path === 'heartbeat' ? { leaseExpiresAt: new Date(now + 45000).toISOString(), cancelJobIds: [] } : null;
  } };
  const session = new ConnectorSession({ api, identity, now: () => now, setIntervalFn: () => 1, clearIntervalFn() {}, adapters: {} });
  session.start(new Date(46000).toISOString());
  await session.tick();
  offline = true; now = 47000; await session.tick();
  assert.equal(session.getState().status, 'recovering');
  offline = false; now = 52000; await session.tick();
  assert.equal(session.getState().status, 'connected');
  session.stop();
});

test('revocation, removal and expired pairings still end the session immediately', async () => {
  for (const failure of [{ status: 401, code: 'DEVICE_UNAUTHORIZED' }, { status: 403, code: 'FORBIDDEN' }, { status: 410, code: 'PAIRING_EXPIRED' }]) {
    let now = 1000;
    const api = { post: async (path) => { if (path === 'heartbeat' && now > 1000) throw Object.assign(new Error('Denied'), failure); return path === 'heartbeat' ? { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [] } : null; } };
    const session = new ConnectorSession({ api, identity, now: () => now, setIntervalFn: () => 1, clearIntervalFn() {}, adapters: {} });
    session.start(new Date(46000).toISOString());
    await session.tick();
    now = 6000; await session.tick();
    assert.equal(session.getState().status, 'authorization_required', failure.code);
  }
});

test('a web lease that stays lapsed past the recovery window ends the session', async () => {
  let now = 1000;
  const api = { post: async (path) => { if (path === 'heartbeat' && now >= 46000) throw Object.assign(new Error('Expired'), { status: 403, code: 'WEB_PERMISSION_EXPIRED' }); return path === 'heartbeat' ? { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [] } : null; } };
  const session = new ConnectorSession({ api, identity, now: () => now, setIntervalFn: () => 1, clearIntervalFn() {}, adapters: {}, recoveryMs: 60000 });
  session.start(new Date(46000).toISOString());
  await session.tick();
  now = 47000; await session.tick();
  assert.equal(session.getState().status, 'recovering');
  now = 100000; await session.tick();
  assert.equal(session.getState().status, 'recovering');
  now = 107000; await session.tick();
  assert.equal(session.getState().status, 'authorization_required');
});

test('server cancellation aborts only the matching job without sending a late final answer', async () => {
  let now = 1000, cancel = false, aborted = false; const results = [];
  const api = { post: async (path, body) => { if (path === 'heartbeat') return { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: cancel ? ['job-1'] : [], heartbeatIntervalSeconds: 5 }; if (path === 'claim') return claim; if (path === 'result') results.push(body); return {}; } };
  const session = new ConnectorSession({ api, identity, now: () => now, setIntervalFn: () => 1, clearIntervalFn: () => {}, adapters: { codex: { run: async ({ signal, onText }) => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; onText('late text'); resolve(); }, { once: true })) } } });
  session.setProviders(providers); session.start(new Date(46000).toISOString()); await session.tick(); now = 7000; cancel = true;
  await session.tick(); await session.whenIdle();
  assert.equal(aborted, true);
  assert.equal(results.some(r => r.status === 'completed' || r.response.includes('late')), false);
  session.stop();
});

test('unavailable model and malformed claim never start a CLI', async () => {
  let runs = 0;
  const api = { post: async path => path === 'heartbeat' ? { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [], heartbeatIntervalSeconds: 5 } : path === 'claim' ? { ...claim, job: { ...claim.job, model: 'unlisted' } } : {} };
  const session = new ConnectorSession({ api, identity, now: () => 1000, setIntervalFn: () => 1, clearIntervalFn: () => {}, adapters: { codex: { run: async () => { runs += 1; } } } });
  session.setProviders(providers); session.start(new Date(46000).toISOString()); await session.tick(); await session.whenIdle(); assert.equal(runs, 0); session.stop();
});

test('transient result failure recovers queue and final full answer without failed state', async () => {
  const results = []; let first = true, now = 1000;
  const api = { post: async (path, body) => {
    if (path === 'heartbeat') return { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [], heartbeatIntervalSeconds: 5 };
    if (path === 'claim') return claim;
    if (path === 'result') { results.push(body); if (first) { first = false; throw Object.assign(new Error('temporary network loss'), { status: 0 }); } }
    return { accepted: true };
  } };
  const session = new ConnectorSession({ api, identity, now: () => now, setIntervalFn: () => 1, clearIntervalFn: () => {}, adapters: { codex: { run: async ({ onText }) => { onText('first'); await new Promise(resolve => setImmediate(resolve)); now = 1700; onText(' second'); } } } });
  session.setProviders(providers); session.start(new Date(46000).toISOString()); await session.tick(); await session.whenIdle();
  assert.equal(results.at(-1).status, 'completed');
  assert.equal(results.at(-1).response, 'first second');
  assert.equal(results.some(result => result.status === 'failed'), false);
  session.stop();
});

test('401 result response cancels active CLI before next heartbeat', async () => {
  let aborted = false;
  const api = { post: async path => {
    if (path === 'heartbeat') return { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [], heartbeatIntervalSeconds: 5 };
    if (path === 'claim') return claim;
    throw Object.assign(new Error('unauthorized'), { status: 401 });
  } };
  const session = new ConnectorSession({ api, identity, now: () => 1000, setIntervalFn: () => 1, clearIntervalFn: () => {}, adapters: { codex: { run: async ({ onText, signal }) => { const done = new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true })); onText('first'); await done; } } } });
  session.setProviders(providers); session.start(new Date(46000).toISOString()); await session.tick(); await session.whenIdle();
  assert.equal(aborted, true); assert.equal(session.getState().status, 'authorization_required');
});

const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };

test('activity distinguishes claim, real spawn, close and network result drain', async () => {
  const finished = deferred(), drain = deferred(); let hooks, resultStarted = false;
  const api = { post: async (path) => {
    if (path === 'heartbeat') return { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [] };
    if (path === 'claim') return claim;
    if (path === 'result') { resultStarted = true; await drain.promise; }
    return {};
  } };
  const session = new ConnectorSession({ api, identity, now: () => 1000, setIntervalFn: () => 1, clearIntervalFn() {}, adapters: { codex: { run: async options => { hooks = options; await finished.promise; } } } });
  session.setProviders(providers); session.start(new Date(46000).toISOString());
  try {
    await session.tick();
    assert.deepEqual(session.getState().activity, { kind: 'preparing' });
    hooks.onLifecycle({ kind: 'spawned' });
    assert.deepEqual(session.getState().activity, { kind: 'running', provider: 'codex', requestedModel: 'model' });
    const copy = session.getState(); copy.activity.requestedModel = 'mutated';
    assert.equal(session.getState().activity.requestedModel, 'model');
    hooks.onText('answer'); await new Promise(resolve => setImmediate(resolve)); assert.equal(resultStarted, true);
    hooks.onLifecycle({ kind: 'closed' });
    assert.deepEqual(session.getState().activity, { kind: 'finalizing' });
    hooks.onLifecycle({ kind: 'spawned' });
    assert.deepEqual(session.getState().activity, { kind: 'finalizing' });
    finished.resolve(); await new Promise(resolve => setImmediate(resolve));
    assert.ok(session.activeJob); assert.deepEqual(session.getState().activity, { kind: 'finalizing' });
    drain.resolve(); await session.whenIdle();
    assert.deepEqual(session.getState().activity, { kind: 'idle' });
  } finally { finished.resolve(); drain.resolve(); session.stop(); await session.whenIdle(); }
});

test('abort, timeout, permission loss and restart never restore execution identity or release cleanup early', async () => {
  for (const action of ['cancel', 'timeout', 'lapse', 'denied', 'stop', 'restart']) {
    let now = 1000, hooks, cancel = false, denied = false, renewed = false, claims = 0;
    const finished = deferred();
    const api = { post: async path => {
      if (path === 'heartbeat') {
        if (denied) throw Object.assign(new Error('denied'), { status: 401 });
        if (!renewed && now >= 46000) throw Object.assign(new Error('expired'), { status: 403, code: 'WEB_PERMISSION_EXPIRED' });
        return { leaseExpiresAt: new Date(renewed ? now + 45000 : 46000).toISOString(), cancelJobIds: cancel ? [claim.job.id] : [] };
      }
      if (path === 'claim') { claims += 1; return claim; }
      return {};
    } };
    const session = new ConnectorSession({ api, identity, now: () => now, maxJobMs: action === 'timeout' ? 10 : 600000, setIntervalFn: () => 1, clearIntervalFn() {}, adapters: { codex: { run: async options => { hooks = options; await finished.promise; } } } });
    session.setProviders(providers); session.start(new Date(46000).toISOString()); await session.tick(); hooks.onLifecycle({ kind: 'spawned' });
    try {
      if (action === 'timeout') await new Promise(resolve => setTimeout(resolve, 20));
      else if (action === 'stop') session.stop();
      else if (action === 'restart') session.start(new Date(46000).toISOString());
      else { now = action === 'lapse' ? 47000 : 7000; cancel = action === 'cancel'; denied = action === 'denied'; await session.tick(); }
      assert.equal(hooks.signal.aborted, true, action);
      assert.deepEqual(session.getState().activity, { kind: ['cancel', 'timeout'].includes(action) ? 'stopping' : 'idle' }, action);
      hooks.onLifecycle({ kind: 'spawned' }); hooks.onLifecycle({ kind: 'closed' });
      assert.equal('provider' in session.getState().activity, false, action);
      assert.ok(session.activeJob, action);
      if (action === 'lapse') { now = 52000; renewed = true; await session.tick(); assert.equal(session.getState().status, 'connected'); assert.equal(session.getState().activity.kind, 'stopping'); }
      await session.tick(); assert.equal(claims, 1, action);
      finished.resolve(); await session.whenIdle(); assert.deepEqual(session.getState().activity, { kind: 'idle' }, action);
    } finally { finished.resolve(); session.stop(); await session.whenIdle(); }
  }
});

test('callbacks from a completed old run cannot change a newer job activity or heartbeat fields', async () => {
  let now = 1000, hooks, count = 0; const requests = [], runs = [];
  const api = { post: async (path, body) => {
    requests.push({ path, body });
    if (path === 'heartbeat') return { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [] };
    if (path === 'claim') return { ...claim, job: { ...claim.job, id: `job-${++count}` } };
    return {};
  } };
  const session = new ConnectorSession({ api, identity, now: () => now, setIntervalFn: () => 1, clearIntervalFn() {}, adapters: { codex: { run: async options => { hooks = options; const finish = deferred(); runs.push(finish); await finish.promise; } } } });
  session.setProviders(providers); session.start(new Date(46000).toISOString()); await session.tick();
  const old = hooks; old.onLifecycle({ kind: 'spawned' }); old.onLifecycle({ kind: 'closed' }); runs[0].resolve(); await session.whenIdle();
  now = 7000; await session.tick(); hooks.onLifecycle({ kind: 'spawned' });
  old.onLifecycle({ kind: 'closed' }); old.onLifecycle({ kind: 'spawned' });
  assert.deepEqual(session.getState().activity, { kind: 'running', provider: 'codex', requestedModel: 'model' });
  assert.ok(requests.filter(value => value.path === 'heartbeat').every(value => Object.keys(value.body).join() === 'providers'));
  session.stop(); runs[1].resolve(); await session.whenIdle();
});

test('apps with a terminal opener report support and open each valid web request once', async () => {
  const opened = [], bodies = [];
  const responses = [
    { terminalRequests: [{ id: 'req-1', provider: 'codex' }] },
    { terminalRequests: [{ id: 'req-1', provider: 'codex' }, { id: 'req-2', provider: 'claude' }] },
    { terminalRequests: [{ id: 'bad id!', provider: 'codex' }, { id: 'req-3', provider: 'bash' }, null] },
    { terminalRequests: [{ id: 'a', provider: 'codex' }, { id: 'b', provider: 'codex' }, { id: 'c', provider: 'codex' }] },
  ];
  let now = 1000;
  const api = { post: async (route, body) => {
    if (route !== 'heartbeat') return null;
    bodies.push(body);
    return { leaseExpiresAt: new Date(now + 45000).toISOString(), cancelJobIds: [], ...(responses.shift() ?? {}) };
  } };
  const session = new ConnectorSession({ api, identity, adapters: {}, now: () => now, setIntervalFn: () => 1, clearIntervalFn() {},
    openTerminal: async provider => { opened.push(provider); return { ok: true }; } });
  session.start(new Date(now + 45000).toISOString());
  try {
    for (let beat = 0; beat < 4; beat += 1) { await session.tick(); now += 5000; }
    assert.deepEqual(bodies[0], { providers: [], bridgeCapabilities: ['terminal_v1'] });
    assert.deepEqual(opened, ['codex', 'claude', 'codex', 'codex']);
  } finally { session.stop(); }
});

test('a failing terminal opener never stops the connection', async () => {
  for (const openTerminal of [() => { throw new Error('no terminal app'); }, async () => { throw new Error('no terminal app'); }]) {
    let now = 1000, beats = 0;
    const api = { post: async route => route === 'heartbeat'
      ? (beats += 1, { leaseExpiresAt: new Date(now + 45000).toISOString(), cancelJobIds: [], terminalRequests: [{ id: `req-${beats}`, provider: 'codex' }] })
      : null };
    const session = new ConnectorSession({ api, identity, adapters: {}, now: () => now, setIntervalFn: () => 1, clearIntervalFn() {}, openTerminal });
    session.start(new Date(now + 45000).toISOString());
    try {
      await session.tick(); now += 5000; await session.tick();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(beats, 2);
      assert.equal(session.getState().status, 'connected');
    } finally { session.stop(); }
  }
});

test('apps without a terminal opener ignore terminal requests', async () => {
  const api = { post: async route => route === 'heartbeat' ? { leaseExpiresAt: new Date(46000).toISOString(), cancelJobIds: [], terminalRequests: [{ id: 'req-1', provider: 'codex' }] } : null };
  const session = new ConnectorSession({ api, identity, adapters: {}, now: () => 1000, setIntervalFn: () => 1, clearIntervalFn() {} });
  session.start(new Date(46000).toISOString());
  try { await session.tick(); assert.equal(session.getState().status, 'connected'); } finally { session.stop(); }
});
