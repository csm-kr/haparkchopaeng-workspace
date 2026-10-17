import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../desktop/package.json', import.meta.url)));
const electronPackage = join(root, 'node_modules', 'electron');
const pathFile = join(electronPackage, 'path.txt');
if (!existsSync(pathFile)) {
  const installed = spawnSync(process.execPath, [join(electronPackage, 'install.js')], { windowsHide: true, shell: false, stdio: 'inherit' });
  if (installed.status !== 0) process.exit(installed.status ?? 1);
}
const executable = join(electronPackage, 'dist', readFileSync(pathFile, 'utf8').trim());
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [root, ...process.argv.slice(2)], { windowsHide: true, shell: false, stdio: 'inherit', env });
child.on('error', () => { process.stderr.write('데스크톱 연결기를 실행하지 못했어요.\n'); process.exitCode = 1; });
child.on('close', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
