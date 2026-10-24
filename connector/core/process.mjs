import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export class JsonLineDecoder {
  constructor(onMessage, maxBytes = 2 * 1024 * 1024) { this.onMessage = onMessage; this.maxBytes = maxBytes; this.buffer = ''; this.decoder = new StringDecoder('utf8'); }
  push(chunk) {
    this.buffer += this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    for (;;) {
      const end = this.buffer.indexOf('\n');
      if (end < 0) break;
      const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
      if (Buffer.byteLength(line) > this.maxBytes) throw new Error('CLI 응답 한 줄이 너무 커요.');
      if (line) this.onMessage(JSON.parse(line));
    }
    if (Buffer.byteLength(this.buffer) > this.maxBytes) throw new Error('CLI 응답이 너무 커요.');
  }
  finish() { this.buffer += this.decoder.end(); if (this.buffer.trim()) this.onMessage(JSON.parse(this.buffer)); this.buffer = ''; }
}

export function terminateProcessTree(child, { platform = process.platform, spawnImpl = spawn } = {}) {
  if (!Number.isInteger(child.pid) || child.pid <= 0) { child.kill?.(); return; }
  if (platform === 'win32') {
    const killer = spawnImpl('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    killer.stdout?.resume(); killer.stderr?.resume();
    killer.on('error', () => child.kill?.()); killer.unref?.();
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill?.('SIGTERM'); }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 750);
    timer.unref?.();
  }
}

export function startJsonProcess(spec, args, { cwd, env = process.env, signal, onMessage = () => {}, onLifecycle = () => {}, timeoutMs = 10 * 60 * 1000, spawnImpl = spawn, platform = process.platform, killTree = child => terminateProcessTree(child, { platform, spawnImpl }), maxLineBytes } = {}) {
  let child, finished = false, spawned = false, failure = null, killed = false, timer;
  const lifecycle = kind => { try { onLifecycle({ kind }); } catch {} };
  const listeners = new Set([onMessage]);
  const kill = () => { if (!killed && child && !finished) { killed = true; killTree(child); } };
  const onAbort = () => { failure ??= Object.assign(new Error('CLI 실행을 취소했어요.'), { name: 'AbortError' }); kill(); };
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Callers may attach after writing the first request; prevent a transient unhandled rejection.
  done.catch(() => {});
  const decoder = new JsonLineDecoder(message => { for (const listener of listeners) listener(message); }, maxLineBytes);
  try {
    child = spawnImpl(spec.command, [...(spec.prefix ?? []), ...args], { cwd, env: { ...env, ...(spec.env ?? {}) }, windowsHide: true, shell: false, detached: platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    child.once('spawn', () => { if (!finished) { spawned = true; lifecycle('spawned'); } });
    child.stdout.on('data', data => { try { decoder.push(data); } catch { failure ??= new Error('CLI 응답 형식을 확인하지 못했어요.'); kill(); } });
    // Drain stderr without reflecting paths, email addresses, credentials or prompts to the web.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', error => { if (finished) return; failure ??= Object.assign(new Error('CLI를 실행하지 못했어요.'), { code: error.code }); if (spawned) { kill(); return; } finished = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); lifecycle('closed'); rejectDone(failure); });
    child.on('close', (code, exitSignal) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      lifecycle('closed');
      try { decoder.finish(); } catch { failure ??= new Error('CLI 응답 형식을 확인하지 못했어요.'); }
      if (failure) rejectDone(failure); else resolveDone({ code, signal: exitSignal });
    });
    timer = setTimeout(() => { failure ??= new Error('CLI 응답 시간이 초과됐어요.'); kill(); }, timeoutMs);
    timer.unref?.();
    if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  } catch { finished = true; lifecycle('closed'); rejectDone(new Error('CLI를 실행하지 못했어요.')); }
  return {
    done,
    get pid() { return child?.pid; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    send(message) { if (finished || killed) throw new Error('종료된 CLI에는 요청할 수 없어요.'); child.stdin.write(`${JSON.stringify(message)}\n`); },
    write(text) { if (finished || killed) throw new Error('종료된 CLI에는 요청할 수 없어요.'); child.stdin.write(text); },
    end() { child?.stdin.end(); },
    cancel: onAbort,
    close: kill,
  };
}
