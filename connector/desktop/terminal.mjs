import { mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const quotePosix = value => `'${value.replaceAll("'", "'\\''")}'`;
const quoteWindows = value => {
  if (/["\r\n\0]/.test(value)) throw new Error('CLI 실행 경로를 확인해 주세요.');
  return `"${value.replaceAll('%', '%%')}"`;
};

export function terminalScript(spec, platform) {
  const args = [spec.command, ...(spec.prefix ?? [])];
  const environment = Object.entries(spec.env ?? {});
  if (platform === 'darwin') return `#!/bin/sh\ncd "$HOME" || exit 1\nexec ${['env', ...environment.map(([key, value]) => `${key}=${value}`), ...args].map(quotePosix).join(' ')}\n`;
  if (platform === 'win32') return `@echo off\r\nsetlocal DisableDelayedExpansion\r\ncd /d "%USERPROFILE%"\r\n${environment.map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || /["\r\n\0]/.test(value)) throw new Error('CLI 실행 환경을 확인해 주세요.');
    return `set "${key}=${value.replaceAll('%', '%%')}"\r\n`;
  }).join('')}${args.map(quoteWindows).join(' ')}\r\n`;
  throw new Error('지원하지 않는 터미널 환경이에요.');
}

export async function openProviderTerminal(provider, { resolve, directory, openPath, platform = process.platform, environment = process.env, exists = existsSync, spawnImpl = spawn } = {}) {
  if (!['codex', 'claude'].includes(provider)) return { ok: false };
  const spec = resolve(provider, { env: environment });
  if (!spec) return { ok: false, message: '먼저 해당 CLI를 설치한 뒤 상태를 다시 확인해 주세요.' };
  if (platform === 'linux') {
    const terminal = ['/usr/bin/x-terminal-emulator', '/usr/bin/gnome-terminal', '/usr/bin/konsole', '/usr/bin/xterm'].find(exists);
    if (!terminal) return { ok: false, message: '터미널 앱을 설치한 뒤 다시 열어 주세요.' };
    const flag = terminal.endsWith('gnome-terminal') ? '--' : '-e';
    return new Promise(resolveResult => {
      const child = spawnImpl(terminal, [flag, spec.command, ...(spec.prefix ?? [])], { cwd: homedir(), env: { ...environment, ...(spec.env ?? {}) }, shell: false, detached: true, stdio: 'ignore' });
      child.once('error', () => resolveResult({ ok: false, message: '터미널을 열지 못했어요. 다시 시도해 주세요.' }));
      child.once('spawn', () => { child.unref(); resolveResult({ ok: true }); });
    });
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${provider}${platform === 'darwin' ? '.command' : '.cmd'}`);
  const temporary = `${path}.${randomUUID()}`;
  await writeFile(temporary, terminalScript(spec, platform), { mode: 0o700 });
  await rename(temporary, path); await chmod(path, 0o700);
  const error = await openPath(path);
  return error ? { ok: false, message: '터미널을 열지 못했어요. 해당 CLI의 설치 안내를 확인해 주세요.' } : { ok: true };
}
