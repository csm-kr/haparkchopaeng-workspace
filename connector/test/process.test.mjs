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

test('lifecycle reports actual spawn and one terminal close without leaking child data', async () => {
  for (const mode of ['close', 'error', 'throw']) {
    const events = [];
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const handle = startJsonProcess({ command: 'private-path', prefix: [] }, ['private-argument'], {
      spawnImpl() { if (mode === 'throw') throw new Error('private-error'); return child; },
      onLifecycle(event) { events.push(event); if (event.kind === 'closed') throw new Error('Observer failure'); },
    });
    assert.deepEqual(events, mode === 'throw' ? [{ kind: 'closed' }] : []);
    if (mode === 'close') { child.emit('spawn'); child.emit('close', 0, null); await handle.done; }
    else { if (mode === 'error') child.emit('error', Object.assign(new Error('private-error'), { code: 'ENOENT' })); await assert.rejects(handle.done); }
    child.emit('close', 1, null); child.emit('spawn');
    assert.deepEqual(events, mode === 'close' ? [{ kind: 'spawned' }, { kind: 'closed' }] : [{ kind: 'closed' }]);
  }
});

test('actual child lifecycle begins at spawn and closes before its completion settles', async () => {
  const events = [];
  const handle = startJsonProcess({ command: process.execPath, prefix: [] }, ['-e', 'console.log("{}")'], { onLifecycle: event => events.push(event.kind) });
  assert.deepEqual(events, []);
  await handle.done;
  assert.deepEqual(events, ['spawned', 'closed']);
});

test('an error after spawn retains process ownership until the actual close event', async () => {
  const child = new EventEmitter(), events = []; let killed = false, settled = false;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const handle = startJsonProcess({ command: 'agent' }, [], { spawnImpl: () => child, onLifecycle: event => events.push(event.kind), killTree: () => { killed = true; } });
  handle.done.catch(() => { settled = true; });
  child.emit('spawn'); child.emit('error', new Error('owned process failure'));
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(killed, true); assert.equal(settled, false); assert.deepEqual(events, ['spawned']);
  child.emit('close', 1, null); await assert.rejects(handle.done);
  assert.deepEqual(events, ['spawned', 'closed']);
});
