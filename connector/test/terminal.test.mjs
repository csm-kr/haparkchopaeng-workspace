import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { terminalScript, openProviderTerminal } from '../desktop/terminal.mjs';

const execute = promisify(execFile);

test('macOS launcher quotes the trusted executable, prefix and environment as literal arguments', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bridge-terminal-'));
  try {
    const cli = join(root, "CLI ' $(touch injected) ; &.mjs"), output = join(root, 'observed.json');
    await writeFile(cli, 'import {writeFileSync} from "node:fs"; writeFileSync(process.argv[2], JSON.stringify({args:process.argv.slice(3), mode:process.env.ELECTRON_RUN_AS_NODE}));');
    let opened;
    const result = await openProviderTerminal('codex', { directory: root, platform: 'darwin',
      resolve: provider => { assert.equal(provider, 'codex'); return { command: process.execPath, prefix: [cli, output, "a'b $(false)"], env: { ELECTRON_RUN_AS_NODE: '1' } }; },
      openPath: async path => { opened = path; await execute('/bin/sh', [path]); return ''; },
    });
    assert.deepEqual(result, { ok: true }); assert.equal(opened, join(root, 'codex.command'));
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { args: ["a'b $(false)"], mode: '1' });
    assert.equal((await stat(opened)).mode & 0o777, 0o700);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('terminal IPC accepts only provider names and handles missing executables and OS handoff errors', async () => {
  let resolved = 0;
  assert.deepEqual(await openProviderTerminal('codex; arbitrary-command', { resolve() { resolved += 1; } }), { ok: false });
  assert.equal(resolved, 0);
  assert.equal((await openProviderTerminal('claude', { resolve: () => null })).ok, false);
  const root = await mkdtemp(join(tmpdir(), 'bridge-terminal-failure-'));
  try {
    const result = await openProviderTerminal('claude', { directory: root, platform: 'darwin', resolve: () => ({ command: '/trusted/claude' }), openPath: async () => 'No associated app' });
    assert.equal(result.ok, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows launcher disables delayed expansion and escapes percent expansion inside quoted paths', () => {
  const script = terminalScript({ command: 'C:\\Program Files\\CLI & 100%\\node.exe', prefix: ['C:\\a!b\\cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }, 'win32');
  assert.ok(script.includes('setlocal DisableDelayedExpansion'));
  assert.ok(script.includes('"C:\\Program Files\\CLI & 100%%\\node.exe" "C:\\a!b\\cli.js"'));
  for (const value of ['bad" & command', 'bad\ncommand']) assert.throws(() => terminalScript({ command: value }, 'win32'));
});

test('Windows launcher executes literal paths, arguments and environment through cmd.exe', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bridge-terminal-'));
  try {
    const cli = join(root, 'CLI 100% ! &.mjs'), output = join(root, 'observed.json');
    await writeFile(cli, 'import {writeFileSync} from "node:fs"; writeFileSync(process.argv[2], JSON.stringify({args:process.argv.slice(3), mode:process.env.ELECTRON_RUN_AS_NODE}));');
    let opened;
    const result = await openProviderTerminal('codex', { directory: root, platform: 'win32',
      resolve: () => ({ command: process.execPath, prefix: [cli, output, "a'b 100% ! &"], env: { ELECTRON_RUN_AS_NODE: '1' } }),
      openPath: async path => { opened = path; await execute(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${path}""`], { windowsVerbatimArguments: true, windowsHide: true }); return ''; },
    });
    assert.deepEqual(result, { ok: true }); assert.equal(opened, join(root, 'codex.cmd'));
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { args: ["a'b 100% ! &"], mode: '1' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Linux starts a separate terminal with fixed argv and no shell or runtime process ownership', async () => {
  let launched, unreferenced = false;
  const result = await openProviderTerminal('claude', { platform: 'linux', resolve: () => ({ command: '/trusted/claude', prefix: [] }),
    exists: path => path === '/usr/bin/gnome-terminal', environment: { PATH: '/usr/bin' },
    spawnImpl(command, args, options) { launched = { command, args, options }; const child = new EventEmitter(); child.unref = () => { unreferenced = true; }; queueMicrotask(() => child.emit('spawn')); return child; },
  });
  assert.deepEqual(result, { ok: true }); assert.equal(launched.command, '/usr/bin/gnome-terminal');
  assert.deepEqual(launched.args, ['--', '/trusted/claude']); assert.equal(launched.options.shell, false);
  assert.equal(launched.options.detached, true); assert.equal(unreferenced, true);
});
