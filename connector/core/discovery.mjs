import { accessSync, constants, realpathSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export function resolveExecutable(provider, { platform = process.platform, arch = process.arch, home = homedir(), env = process.env, realpath = realpathSync, listDirectories = path => { try { return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { return []; } }, exists = path => { try { accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK); return true; } catch { return false; } } } = {}) {
  const path = platform === 'win32' ? win32 : posix;
  const clean = value => platform === 'win32' ? value.replaceAll('\\', '/') : value;
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  if (platform !== 'win32') {
    dirs.push(path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin'), path.join(home, '.volta', 'bin'));
    const versions = listDirectories(path.join(home, '.nvm', 'versions', 'node')).filter(name => /^v\d+\.\d+\.\d+$/.test(name)).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }));
    dirs.push(...versions.slice(0,8).map(version => path.join(home, '.nvm', 'versions', 'node', version, 'bin')));
  }
  const candidates = [];
  if (provider === 'claude') candidates.push(path.join(home, '.local', 'bin', platform === 'win32' ? 'claude.exe' : 'claude'));
  if (platform === 'win32' && provider === 'codex') {
    const bases = [env.APPDATA && path.join(env.APPDATA, 'npm'), ...dirs].filter(Boolean);
    for (const base of bases) candidates.push(path.join(base, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor', arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'));
  }
  for (const dir of [...dirs, ...(platform === 'win32' ? [] : [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'])]) candidates.push(path.join(dir, provider + (platform === 'win32' ? '.exe' : '')));
  for (const candidate of candidates) if (exists(candidate)) {
    let resolved; try { resolved = clean(realpath(candidate)); } catch { resolved = clean(candidate); }
    if (resolved.endsWith('/@openai/codex/bin/codex.js') || resolved.endsWith('/@anthropic-ai/claude-code/cli.js')) return { command: process.execPath, prefix: [resolved], env: { ELECTRON_RUN_AS_NODE: '1' } };
    return { command: clean(candidate), prefix: [] };
  }
  // Recognized npm distribution only: bypass cmd/PowerShell shims and preserve argv exactly.
  if (provider === 'codex') {
    for (const base of [env.APPDATA && path.join(env.APPDATA, 'npm'), ...dirs].filter(Boolean)) {
      const entry = path.join(base, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (exists(entry)) return { command: process.execPath, prefix: [clean(entry)], env: { ELECTRON_RUN_AS_NODE: '1' } };
    }
  }
  return null;
}
