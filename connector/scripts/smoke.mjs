import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderAdapter } from '../core/adapters.mjs';

const selected = process.argv.find(argument => argument.startsWith('--provider='))?.split('=')[1];
if (selected && !['codex', 'claude'].includes(selected)) throw new Error('Unknown provider');
const infer = process.argv.includes('--infer');
const directory = await mkdtemp(join(tmpdir(), 'hapark-connector-smoke-'));
try {
  for (const provider of selected ? [selected] : ['codex', 'claude']) {
    const adapter = createProviderAdapter(provider, { workspaceRoot: directory, onDiagnostic: process.argv.includes('--diagnose') ? data => console.log(JSON.stringify({ provider, phase: 'diagnostic', ...data })) : undefined });
    const signal = AbortSignal.timeout(infer ? 90000 : 40000);
    const snapshot = await adapter.detect(signal);
    console.log(JSON.stringify({ provider, phase: 'metadata', status: snapshot.status, modelCount: snapshot.models.length, quotaWindows: snapshot.quota ? Object.keys(snapshot.quota).filter(key => snapshot.quota[key]) : [], message: snapshot.message }));
    if (snapshot.status !== 'ready') { process.exitCode = 1; continue; }
    if (infer) {
      const preferred = provider === 'codex' ? 'gpt-6-luna' : 'haiku';
      const model = snapshot.models.find(item => item.id === preferred)?.id ?? snapshot.models[0]?.id;
      if (!model) { process.exitCode = 1; continue; }
      let answer = '';
      try {
        await adapter.run({ model, prompt: 'What is 2 + 2? Reply with only the number.', context: '', signal, onText: text => { answer += text; } });
        const passed = /^\s*4[.!]?\s*$/.test(answer);
        console.log(JSON.stringify({ provider, phase: 'inference', passed, model, answer: answer.slice(0,80) }));
        if (!passed) process.exitCode = 1;
      } catch (error) { console.log(JSON.stringify({ provider, phase: 'inference', passed: false, message: error.message, code: error.code ?? null })); process.exitCode = 1; }
    }
  }
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
