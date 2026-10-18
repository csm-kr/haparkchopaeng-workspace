import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terminateProcessTree } from '../core/process.mjs';

const execute = promisify(execFile), root = dirname(dirname(fileURLToPath(import.meta.url)));
const qaDir = await mkdtemp(join(tmpdir(),'hapark-desktop-flow-'));
const data = join(qaDir,'data'), profile = join(qaDir,'profile'); await mkdir(data); await mkdir(profile);
const stateFile = join(qaDir,'state.json');
const wait = milliseconds => new Promise(resolve=>setTimeout(resolve,milliseconds));
let server, application;
async function cleanup(pid) {
  if(!pid)return;
  try { process.kill(pid,0); } catch { return; }
  if(process.platform==='win32')await execute('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,shell:false,timeout:10000}).catch(()=>{});
  else terminateProcessTree({pid,kill:()=>{}});
  for(let count=0;count<50;count+=1){try{process.kill(pid,0)}catch{return}await wait(100)}
  throw new Error('Owned QA process did not terminate');
}
async function background(command,args,name,extraEnv={}) {
  const out=await open(join(qaDir,`${name}.out`),'a'),err=await open(join(qaDir,`${name}.err`),'a');
  const env={...process.env,...extraEnv};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(command,args,{windowsHide:true,shell:false,detached:true,env,stdio:['ignore',out.fd,err.fd]});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();await out.close();await err.close();return child;
}
try {
  const electron = join(root,'desktop/node_modules/electron/dist',(await readFile(join(root,'desktop/node_modules/electron/path.txt'),'utf8')).trim());
  server=await background(process.execPath,[join(root,'test/fixtures/desktop-api.mjs')],'server');
  let listening=false;
  for(let retry=0;retry<100;retry+=1){if(server.exitCode!==null)throw new Error('Fixture could not bind loopback port 3000');if((await readFile(join(qaDir,'server.out'),'utf8')).includes('"desktopFixture":true')){listening=true;break}await wait(50)}
  if(!listening)throw new Error('Fixture did not start');
  application=await background(electron,[join(root,'desktop'),'--connector-dev','--no-auto-open','--connector-qa',...(process.platform==='win32'?['--connector-qa-tray']:[]),`--connector-data-dir=${data}`,`--user-data-dir=${profile}`,'--remote-debugging-port=0',`hapark-connect://connect?attemptId=qa-attempt-1&launchToken=${'a'.repeat(43)}`],'app');
  await writeFile(stateFile,JSON.stringify({qaDir,data,profile,pid:application.pid,serverPid:server.pid}));
  let port;
  for(let retry=0;retry<100;retry+=1){try{port=Number((await readFile(join(data,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break}catch{}await wait(100)}
  if(!port)throw new Error('Electron did not publish its debugging endpoint');
  const options={cwd:root,windowsHide:true,timeout:120000,maxBuffer:65536};
  const flow=await execute(process.execPath,[join(root,'scripts/desktop-qa.mjs'),`--port=${port}`,'--flow'],options);process.stdout.write(flow.stdout);
  const recovery=await execute(process.execPath,[join(root,'scripts/desktop-recovery-qa.mjs'),`--state=${stateFile}`],options);process.stdout.write(recovery.stdout);
} finally {
  // PIDs originate only from this fixture and this task-owned state file, never a browser search.
  try { const state=JSON.parse(await readFile(stateFile,'utf8'));if(state.pid!==application?.pid)await cleanup(state.pid) } catch {}
  await cleanup(application?.pid);
  await cleanup(server?.pid);
  console.log(JSON.stringify({qaDirectory:qaDir,cleanupRequested:true}));
}
