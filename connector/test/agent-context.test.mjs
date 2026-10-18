import test from 'node:test';
import assert from 'node:assert/strict';
import { inferenceContract, codexArguments } from '../core/adapters.mjs';

test('agent planning has a dedicated JSON contract while executable CLI tools stay disabled', () => {
  const task = inferenceContract(JSON.stringify({ version: 1, kind: 'agent_task', execution: { effort: 'high' } }));
  assert.equal(task.kind, 'agent_task');
  assert.equal(task.effort, 'high');
  assert.match(task.instructions, /JSON/);
  assert.match(task.instructions, /untrusted/);
  assert.match(task.instructions, /NO tools/);
  const args = codexArguments('actual-model', 'high', task.instructions);
  assert.ok(args.includes('features.shell_tool=false'));
  assert.ok(args.includes('mcp_servers={}'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  const chat = inferenceContract(JSON.stringify({ version: 1, kind: 'research_chat', execution: { effort: 'low' } }));
  assert.equal(chat.kind, 'research_chat');
  assert.match(chat.instructions, /research assistant/);
  assert.equal(chat.effort, 'low');
  assert.throws(() => inferenceContract(JSON.stringify({ version: 99, kind: 'agent_task' })));
});
