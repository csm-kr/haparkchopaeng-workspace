import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('Installer QA requires a clean Windows user');
const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./verify-windows-installer.ps1', import.meta.url))], { windowsHide: true, shell: false, stdio: 'inherit' });
child.on('error', () => { console.error('Installer QA could not start'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
