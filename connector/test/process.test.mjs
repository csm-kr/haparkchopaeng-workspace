import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { JsonLineDecoder, startJsonProcess, terminateProcessTree } from '../core/process.mjs';

test('JSONL preserves split Unicode and rejects malformed or excessive lines', () => {
  const messages = [];
  const decoder = new JsonLineDecoder(value => messages.push(value), 80);
  const bytes = Buffer.from('{"text":"하박조팽"}\n{"n":2}\n');
  decoder.push(bytes.subarray(0, 12));
  decoder.push(bytes.subarray(12));
  decoder.finish();
  assert.deepEqual(messages, [{ text: '하박조팽' }, { n: 2 }]);
  assert.throws(() => new JsonLineDecoder(() => {}).push(Buffer.from('not json\n')));
  assert.throws(() => new JsonLineDecoder(() => {}, 8).push(Buffer.from('123456789')));
});

test('child launches without shell and hidden window even when command path has spaces', async () => {
  let captured;
  const child = new EventEmitter();
  child.pid = 123;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
  const messages = [];
  const handle = startJsonProcess({ command: 'C:/Program Files/agent.exe', prefix: [] }, ['a b', '"x"'], { spawnImpl: (command, args, options) => { captured = { command, args, options }; return child; }, platform: 'win32', onMessage: m => messages.push(m), killTree: () => child.kill() });
  assert.equal(captured.command, 'C:/Program Files/agent.exe');
  assert.deepEqual(captured.args, ['a b', '"x"']);
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.windowsHide, true);
  child.stdout.write('{"ok":true}\n');
  child.emit('close', 0, null);
  assert.equal((await handle.done).code, 0);
  assert.deepEqual(messages, [{ ok: true }]);
});

test('abort and malformed child output terminate the owned process', async () => {
  for (const malformed of [false, true]) {
    const abort = new AbortController();
    const child = new EventEmitter(); child.pid = 123;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let killed = 0;
    const handle = startJsonProcess({ command: 'agent', prefix: [] }, [], { spawnImpl: () => child, signal: abort.signal, killTree: () => { killed += 1; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); } });
    if (malformed) child.stdout.write('invalid\n'); else abort.abort();
    await assert.rejects(handle.done);
    assert.equal(killed, 1);
  }
});

test('Windows cancellation invokes taskkill for the exact owned PID with hidden window', () => {
  let captured;
  const killer = new EventEmitter(); killer.unref = () => {};
  terminateProcessTree({ pid: 321, kill: () => {} }, { platform: 'win32', spawnImpl: (command, args, options) => { captured = { command, args, options }; return killer; } });
  assert.deepEqual(captured.args, ['/PID', '321', '/T', '/F']);
  assert.equal(captured.options.windowsHide, true);
  assert.equal(captured.options.shell, false);
});

test('actual hidden Node child is gone after cancellation completes', { timeout: 10000 }, async () => {
  const controller = new AbortController();
  const handle = startJsonProcess({ command: process.execPath, prefix: [] }, ['-e', 'console.log(JSON.stringify({ready:true}));setInterval(()=>{},1000)'], {
    signal: controller.signal, onMessage: () => controller.abort(), timeoutMs: 5000,
  });
  let timer;
  try {
    await assert.rejects(Promise.race([handle.done, new Promise((_resolve,reject) => { timer = setTimeout(() => reject(new Error('Native cancellation did not complete')), 6000); })]), error => error.name === 'AbortError');
    assert.throws(() => process.kill(handle.pid, 0));
  } finally {
    clearTimeout(timer);
    try { process.kill(handle.pid, 0); if(process.platform==='win32')execFileSync('taskkill.exe',['/PID',String(handle.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else process.kill(handle.pid,'SIGKILL'); } catch {}
  }
});
