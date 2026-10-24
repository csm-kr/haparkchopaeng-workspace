import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeArguments, claudeUserMessage, codexArguments, codexMetadataArguments, normalizeCodexQuota, normalizeClaudeQuota, providerText, normalizeModels, versionSupported, safeFailureDiagnostic } from '../core/adapters.mjs';
import { resolveExecutable } from '../core/discovery.mjs';
import { createProviderAdapter } from '../core/adapters.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Claude advertises only model-specific effort levels confirmed by its own initialize catalog', () => {
  assert.deepEqual(normalizeModels('claude', [
    { value: 'opus', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'high', 'invented'] },
    { value: 'claude-opus-4-6', displayName: 'Opus 4.6', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
    { value: 'haiku-legacy', displayName: 'Legacy Haiku' },
    { value: 'unsupported', displayName: 'Unsupported', supportsEffort: false, supportedEffortLevels: ['high'] },
    { value: 'no-confirmation', displayName: 'Unknown', supportedEffortLevels: ['high'], supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
    { value: 'bad-shape', displayName: 'Invalid', supportsEffort: true, supportedEffortLevels: 'high' },
  ]), [
    { id: 'opus', name: 'Opus', reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'claude-opus-4-6', name: 'Opus 4.6', reasoningEfforts: ['low', 'medium', 'high', 'max'] },
    { id: 'haiku-legacy', name: 'Legacy Haiku' }, { id: 'unsupported', name: 'Unsupported' },
    { id: 'no-confirmation', name: 'Unknown' }, { id: 'bad-shape', name: 'Invalid' },
  ]);
});

test('explicit effort reaches each CLI as a validated argument', () => {
  assert.ok(codexArguments('actual-model', 'high').includes('model_reasoning_effort="high"'));
  const claude = claudeArguments('sonnet', 'medium');
  assert.equal(claude[claude.indexOf('--effort') + 1], 'medium');
  assert.throws(() => codexArguments('actual-model', 'high; run-command'));
  assert.throws(() => claudeArguments('sonnet', 'unknown'));
});

test('actual Codex model efforts are preserved while legacy catalogues stay compatible', () => {
  assert.deepEqual(normalizeModels('codex', [{ id: 'actual-model', displayName: 'Actual', supportedReasoningEfforts: [
    { reasoningEffort: 'high' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }, { reasoningEffort: 'run-shell' },
  ] }]), [{ id: 'actual-model', name: 'Actual', reasoningEfforts: ['high', 'medium'] }]);
  assert.deepEqual(normalizeModels('codex', [{ id: 'legacy-model', displayName: 'Legacy' }]), [{ id: 'legacy-model', name: 'Legacy' }]);
});

test('server chat context effort is applied to the launched CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hapark-effort-'));
  const launched = [];
  const processFactory = (_spec, args, options) => {
    launched.push(args);
    const listeners = new Set([options.onMessage ?? (() => {})]);
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const emit = message => { for (const listener of listeners) listener(message); };
    return { done, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, send(message) {
      if (message.type === 'control_request') queueMicrotask(() => emit({ type: 'control_response', response: { request_id: message.request_id, subtype: 'success', response: { models: [{ value: 'sonnet', displayName: 'Sonnet' }] } } }));
      if (message.type === 'user') queueMicrotask(() => { emit({ type: 'result', subtype: 'success', is_error: false, result: '완료' }); finish({ code: 0, signal: null }); });
    }, end() {}, close() { finish({ code: 0, signal: null }); } };
  };
  const adapter = createProviderAdapter('claude', { workspaceRoot: root, resolve: () => ({ command: 'fake-claude', prefix: [] }), execute: async (_command, args) => ({ stdout: args.includes('--version') ? '2.1.301' : '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}' }), processFactory });
  try {
    await adapter.detect();
    await adapter.run({ model: 'sonnet', prompt: '이야기를 이어가자', context: JSON.stringify({ version: 1, kind: 'research_chat', papers: [], history: [], execution: { effort: 'high' } }), onText() {} });
    const args = launched.at(-1);
    assert.equal(args[args.indexOf('--effort') + 1], 'high');
    const count = launched.length;
    await assert.rejects(adapter.run({ model: 'sonnet', prompt: '질문', context: JSON.stringify({ version: 1, kind: 'research_chat', execution: { effort: 'invalid' } }), onText() {} }));
    assert.equal(launched.length, count);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Claude disables built-in/MCP tools, customizations, persistence and prompt expansion', () => {
  const args = claudeArguments('sonnet');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  for (const flag of ['--restricted', '--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  const message = claudeUserMessage('@C:/secret.txt\n/delete everything');
  assert.equal(message.client_composed, true);
  assert.equal(message.message.content[0].text, '@C:/secret.txt\n/delete everything');
  assert.throws(() => claudeArguments('sonnet --dangerously-skip-permissions'));
});

test('Codex ignores user configuration, removes executable tools and uses read-only ephemeral session', () => {
  const args = codexArguments('gpt-6.1-sol');
  for (const flag of ['--no-daemon', '--ignore-user-config', '--ephemeral', '--json', '--sandbox']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  for (const option of ['features.shell_tool=false', 'features.view_image=false', 'features.multi_agent=false', 'features.plugins=false', 'features.hooks=false', 'web_search="disabled"', 'mcp_servers={}']) assert.ok(args.includes(option));
  assert.equal(args.at(-1), '-');
});

test('quota uses actual duration, preserving zero and absence instead of fixed primary=5h', () => {
  const iso = '2026-10-17T00:00:00.000Z';
  const quota = normalizeCodexQuota({ rateLimits: { primary: { usedPercent: 27, windowDurationMins: 10080, resetsAt: 1800000000 }, secondary: null } });
  assert.equal(quota.short, null);
  assert.equal(quota.weekly.remainingPercent, 73);
  assert.equal(normalizeCodexQuota({ rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 0 } } }).short.remainingPercent, 0);
  assert.equal(normalizeCodexQuota({ rateLimits: { primary: { usedPercent: -1, windowDurationMins: 300 } } }), null);
  assert.equal(normalizeCodexQuota({ rateLimits: { primary: { usedPercent: 20, windowDurationMins: 15 } } }), null);
  const c = normalizeClaudeQuota({ status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.38, resetsAt: 1800000000 }, seven_day: { utilization: 0.56, resetsAt: 1800000000 } } });
  assert.equal(c.short.remainingPercent, 62);
  assert.equal(c.weekly.remainingPercent, 44);
  assert.equal(normalizeClaudeQuota({ status: 'allowed' }), null);
  assert.equal(iso.endsWith('Z'), true);
});

test('stream parser emits answer text only, not thoughts, tool inputs or auth metadata', () => {
  assert.equal(providerText('claude', { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '4' } }, parent_tool_use_id: null }), '4');
  assert.equal(providerText('claude', { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private' } } }), null);
  assert.equal(providerText('codex', { type: 'item.completed', item: { type: 'agent_message', text: '4' } }), '4');
  assert.equal(providerText('codex', { type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'secret' } }), null);
  assert.deepEqual(normalizeModels('claude', [{ value: 'default', displayName: 'Default' }, { value: 'sonnet', displayName: 'Sonnet' }, { value: 'bad model', displayName: 'bad' }]), [{ id: 'sonnet', name: 'Sonnet' }]);
  assert.equal(versionSupported('claude', '2.1.301 (Claude Code)'), true);
  assert.equal(versionSupported('claude', '2.1.100'), false);
});

test('discovery prefers native CLI paths and never launches .cmd through a shell', () => {
  const file = 'C:/Users/test user/.local/bin/claude.exe';
  assert.deepEqual(resolveExecutable('claude', { platform: 'win32', arch: 'x64', home: 'C:/Users/test user', env: { PATH: '' }, exists: path => path.replaceAll('\\', '/') === file }), { command: file, prefix: [] });
  assert.equal(resolveExecutable('claude', { platform: 'win32', home: 'C:/nobody', env: { PATH: 'C:/shim' }, exists: path => path.endsWith('claude.cmd') }), null);
});

test('Finder launched Mac app uses bundled Electron Node for official npm CLI symlink', () => {
  const spec = resolveExecutable('codex', { platform: 'darwin', home: '/Users/researcher', env: { PATH: '/usr/bin:/bin' }, exists: path => path === '/opt/homebrew/bin/codex', realpath: () => '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js', listDirectories: () => [] });
  assert.equal(spec.command, process.execPath);
  assert.deepEqual(spec.prefix, ['/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js']);
  assert.equal(spec.env.ELECTRON_RUN_AS_NODE, '1');
});

test('Ubuntu GUI with short PATH detects an installed nvm native CLI', () => {
  const spec = resolveExecutable('claude', { platform: 'linux', home: '/home/researcher', env: { PATH: '/usr/bin:/bin' }, exists: path => path === '/home/researcher/.nvm/versions/node/v24.15.0/bin/claude', listDirectories: () => ['v24.15.0'] });
  assert.equal(spec.command, '/home/researcher/.nvm/versions/node/v24.15.0/bin/claude');
});

test('Codex metadata disables hooks, plugins, MCP and native execution before initialization', () => {
  const args = codexMetadataArguments();
  for (const value of ['--no-daemon', 'app-server', '--stdio', 'features.hooks=false', 'features.plugins=false', 'features.shell_tool=false', 'mcp_servers={}']) assert.ok(args.includes(value));
});

test('Claude API-key and external-provider logins require subscription OAuth before model discovery', async () => {
  for (const auth of [
    { loggedIn: true, authMethod: 'apiKey', apiProvider: 'firstParty' },
    { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' },
    { loggedIn: true },
  ]) {
    const root = await mkdtemp(join(tmpdir(), 'hapark-auth-mode-'));
    let initialized = false;
    const adapter = createProviderAdapter('claude', { workspaceRoot: root, resolve: () => ({ command: 'fake-claude', prefix: [] }),
      execute: async (_command, args) => ({ stdout: args.includes('--version') ? '2.1.301' : JSON.stringify(auth) }),
      processFactory: () => { initialized = true; throw new Error('Model discovery must not start'); },
    });
    try {
      assert.equal((await adapter.detect()).status, 'login_required');
      assert.equal(initialized, false);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('failure diagnostics output only fixed reason, HTTP status and known API type', () => {
  const diagnostics = safeFailureDiagnostic('API Error: 400 {"error":{"type":"invalid_request_error","message":"Unsupported model secret@example.test token-secret"}}');
  assert.deepEqual(diagnostics, { httpStatus: 400, apiErrorType: 'invalid_request_error', reason: 'model_unavailable' });
  assert.equal(JSON.stringify(diagnostics).includes('secret'), false);
  assert.deepEqual(safeFailureDiagnostic('API Error: 403 {"error":{"type":"permission_error","message":"Permission denied"}}'), { httpStatus: 403, apiErrorType: 'permission_error', reason: 'permission' });
  assert.deepEqual(safeFailureDiagnostic('Unrecognized response'), { httpStatus: null, apiErrorType: null, reason: 'unknown' });
});

test('Claude assistant error and success/is_error result are failures, empty errors array falls back to result', async () => {
  for (const detail of [{ assistantError: 'rate_limit', result: '', expected: 'RATE_LIMITED' }, { result: 'Credit balance is too low', expected: 'BILLING_REQUIRED' }]) {
    const root = await mkdtemp(join(tmpdir(), 'hapark-adapter-test-'));
    const processFactory = (_spec, _args, options) => {
      const listeners = new Set([options.onMessage ?? (() => {})]); let resolve;
      const done = new Promise(value => { resolve = value; });
      const emit = message => { for (const listener of [...listeners]) listener(message); };
      return { done, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, send(message) {
        if (message.type === 'control_request') queueMicrotask(() => emit({ type: 'control_response', response: { request_id: message.request_id, subtype: 'success', response: { models: [{ value: 'haiku', displayName: 'Haiku' }] } } }));
        else if (message.type === 'user') queueMicrotask(() => { if (detail.assistantError) emit({ type: 'assistant', error: detail.assistantError }); emit({ type: 'result', subtype: 'success', is_error: true, errors: [], result: detail.result }); resolve({ code: 1, signal: null }); });
      }, end() {}, close() { resolve({ code: 0, signal: null }); } };
    };
    const adapter = createProviderAdapter('claude', { workspaceRoot: root, resolve: () => ({ command: 'fake-claude', prefix: [] }), execute: async (_command, args) => ({ stdout: args.includes('--version') ? '2.1.301' : '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}' }), processFactory });
    try {
      assert.equal((await adapter.detect()).status, 'ready');
      await assert.rejects(adapter.run({ model: 'haiku', prompt: '2+2', onText: () => {} }), error => error.code === detail.expected);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('Claude metadata refresh does not relabel previously observed quota as newly fetched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hapark-quota-freshness-'));
  let now = 1000;
  const processFactory = (_spec, _args, options) => {
    const listeners = new Set([options.onMessage ?? (() => {})]); let resolve; const done = new Promise(value => { resolve = value; });
    const emit = message => { for (const listener of [...listeners]) listener(message); };
    return { done, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, send(message) {
      if (message.type === 'control_request') queueMicrotask(() => emit({ type: 'control_response', response: { request_id: message.request_id, subtype: 'success', response: { models: [{ value: 'haiku', displayName: 'Haiku' }] } } }));
      else if (message.type === 'user') queueMicrotask(() => { emit({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.2, resetsAt: 1800000000 } }); emit({ type: 'result', subtype: 'success', is_error: false, result: '4' }); resolve({ code: 0, signal: null }); });
    }, end() {}, close() { resolve({ code: 0, signal: null }); } };
  };
  const adapter = createProviderAdapter('claude', { workspaceRoot: root, now: () => now, resolve: () => ({ command: 'fake-claude', prefix: [] }), execute: async (_command, args) => ({ stdout: args.includes('--version') ? '2.1.301' : '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}' }), processFactory });
  try {
    await adapter.detect(); await adapter.run({ model: 'haiku', prompt: '2+2', onText: () => {} });
    assert.equal(adapter.getSnapshot().quota.short.remainingPercent, 80);
    assert.equal(adapter.getSnapshot().quotaObservedAt, new Date(1000).toISOString());
    now = 31000;
    const next = await adapter.detect();
    assert.equal(next.quota.short.remainingPercent, 80);
    assert.equal(next.quotaObservedAt, new Date(1000).toISOString());
    assert.equal(next.observedAt, new Date(31000).toISOString());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runs capture the validated executable and catalogue before discovery or workspace awaits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hapark-atomic-launch-'));
  let command = 'validated-old', releaseVersion, holdVersion = false;
  const launches = [], lifecycle = [];
  const adapter = createProviderAdapter('claude', { workspaceRoot: root,
    resolve: () => ({ command, prefix: [], env: { ELECTRON_RUN_AS_NODE: '1' } }),
    execute: async (_command, args) => {
      if (args.includes('--version')) { if (holdVersion) await new Promise(resolve => { releaseVersion = resolve; }); return { stdout: '2.1.301' }; }
      return { stdout: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}' };
    },
    processFactory(spec, args, options) {
      const listeners = new Set([options.onMessage ?? (() => {})]); let finish;
      const done = new Promise(resolve => { finish = resolve; });
      const emit = value => { for (const listener of [...listeners]) listener(value); };
      if (args.includes('--model')) launches.push(structuredClone(spec));
      const close = () => { options.onLifecycle?.({ kind: 'closed' }); finish({ code: 0, signal: null }); };
      queueMicrotask(() => options.onLifecycle?.({ kind: 'spawned' }));
      return { done, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        send(message) {
          if (message.type === 'control_request') queueMicrotask(() => emit({ type: 'control_response', response: { request_id: message.request_id, subtype: 'success', response: { models: [{ value: 'haiku', displayName: 'Haiku' }] } } }));
          if (message.type === 'user') queueMicrotask(() => { emit({ type: 'result', subtype: 'success', result: '4' }); close(); });
        }, close, end() {},
      };
    },
  });
  const run = () => adapter.run({ model: 'haiku', prompt: 'question', onText() {}, onLifecycle: event => lifecycle.push(event) });
  try {
    await adapter.detect();
    command = 'unvalidated-new'; holdVersion = true;
    const detecting = adapter.detect();
    await run();
    assert.equal(launches.at(-1).command, 'validated-old');
    holdVersion = false; releaseVersion(); await detecting;
    const running = run();
    command = 'replacement-during-workspace'; const replacing = adapter.detect();
    await running; await replacing;
    assert.equal(launches.at(-1).command, 'unvalidated-new');
    await run(); assert.equal(launches.at(-1).command, 'replacement-during-workspace');
    assert.ok(lifecycle.some(value => value.kind === 'spawned'));
    assert.ok(lifecycle.every(value => Object.keys(value).join() === 'kind'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
