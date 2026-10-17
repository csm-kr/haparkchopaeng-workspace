import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv.find(value => value.startsWith('--state='))?.slice('--state='.length);
if (!file) throw new Error('Pass the owned fixture state.json');
const qa = JSON.parse(await readFile(file, 'utf8'));
if (!resolve(qa.qaDir).startsWith(resolve(tmpdir())) || !basename(qa.qaDir).startsWith('hapark-desktop-flow-') || resolve(file) !== resolve(qa.qaDir, 'state.json')) throw new Error('Unexpected QA directory');
const root = dirname(dirname(fileURLToPath(import.meta.url))), desktop = join(root, 'desktop'), artifacts = join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const executable = join(desktop, 'node_modules', 'electron', 'dist', (await readFile(join(desktop,'node_modules/electron/path.txt'),'utf8')).trim());
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const execute = promisify(execFile);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitForExit(pid) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (!alive(pid)) return; await pause(100); }
  throw new Error('Owned Electron did not exit itself after authorization ended');
}
async function closeOwnedWindow() {
  if (process.platform !== 'win32') throw new Error('Native window-close QA currently requires Windows');
  await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'test/fixtures/close-owned-window.ps1'),'-OwnedProcessId',String(qa.pid)],{windowsHide:true,shell:false,timeout:10000});
}
const fixture = async (path, body) => (await (await fetch(`http://127.0.0.1:3000/_qa/${path}`, body ? { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) } : undefined)).json()).data;
let socket;
async function connect() {
  const deadline = Date.now()+20000;
  while(Date.now()<deadline) {
    try {
      const port = Number((await readFile(join(qa.data,'DevToolsActivePort'),'utf8')).split('\n')[0]);
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(value=>value.type==='page'&&value.url.endsWith('/renderer/index.html'));
      if(!target) throw new Error();
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
      let id=0;const pending=new Map();
      socket.addEventListener('message',event=>{const message=JSON.parse(event.data);const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);message.error?waiter.reject(new Error(message.error.message)):waiter.resolve(message.result)}});
      socket.addEventListener('close',()=>{for(const waiter of pending.values())waiter.reject(new Error('Owned app closed'));pending.clear();});
      const cdp=(method,params={})=>new Promise((resolve,reject)=>{const current=++id,timer=setTimeout(()=>{pending.delete(current);reject(new Error(`CDP timeout: ${method}`))},10000);pending.set(current,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id:current,method,params}));});
      const js=async expression=>{const value=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.text);return value.result.value};
      const bridgeDeadline=Date.now()+10000;
      while(!(await js('typeof window.connector?.state === "function"'))){if(Date.now()>=bridgeDeadline)throw new Error('Preload bridge did not initialize');await pause(50)}
      return {cdp,js};
    } catch { socket?.close(); await pause(150); }
  }
  throw new Error('Owned Electron did not start');
}
async function launch(attemptId) {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const out=await open(join(qa.qaDir,'recovery.out'),'a'),err=await open(join(qa.qaDir,'recovery.err'),'a');
  const child=spawn(executable,[desktop,'--connector-dev','--no-auto-open','--connector-qa',`--connector-data-dir=${qa.data}`,`--user-data-dir=${qa.profile}`,'--remote-debugging-port=0',`hapark-connect://connect?attemptId=${attemptId}&launchToken=${'b'.repeat(43)}`],{windowsHide:true,shell:false,detached:true,env,stdio:['ignore',out.fd,err.fd]});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();await out.close();await err.close();return child.pid;
}
let client=await connect();
const waitFor=async expression=>{const deadline=Date.now()+20000;while(Date.now()<deadline){if(await client.js(expression))return;await pause(100)}throw new Error(`Condition not reached: ${expression}`)};
const snapshot=async name=>{const data=await client.cdp('Page.captureScreenshot',{format:'png',fromSurface:true});await writeFile(join(artifacts,`${name}.png`),Buffer.from(data.data,'base64'))};
const click=async selector=>{const point=await client.js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await client.cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await client.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
const findings=[];
try {
  await waitFor('(async()=> (await window.connector.state()).stage === "connected")()');
  const encrypted = await readFile(join(qa.data,'devices.enc.json'),'utf8');
  if(encrypted.includes('deviceToken')||encrypted.includes('qa-device-1')||JSON.parse(encrypted).version!==1)throw new Error('Device store is not encrypted');
  findings.push('actual-os-encrypted-storage');
  try { await client.js('window.connector.quit()'); } catch {} await waitForExit(qa.pid); socket.close();
  findings.push('explicit-quit-waits-for-process-exit');
  qa.pid=await launch('qa-attempt-2');await writeFile(file,JSON.stringify(qa));
  client=await connect();
  await waitFor('(async()=> (await window.connector.state()).stage === "connected")()');
  await snapshot('desktop-reopened');
  const stats=await fixture('stats');if(stats.pair!==2||stats.fingerprints.length!==1)throw new Error('Cold launch did not reuse the encrypted device credential');
  findings.push('cold-launch-without-another-code','same-device-key-reused');
  await fixture('control',{mode:'unauthorized'});await waitFor('(async()=> (await window.connector.state()).stage === "authorization_required")()');await snapshot('desktop-session-expired');findings.push('401-stops-and-requests-web-reconnect');
  await fixture('control',{mode:'require_pairing'});await launch('qa-attempt-3');await waitFor('(async()=> (await window.connector.state()).stage === "pairing")()');
  if(!(await client.js('document.querySelector("#code").value === "" && document.querySelector("#pair-button").disabled')))throw new Error('New authorization reused a previous code');
  for(let count=0;count<5;count+=1){await client.js('document.querySelector("#code").focus();document.querySelector("#code").select()');await client.cdp('Input.insertText',{text:'111111'});await click('#pair-button');if(count<4)await waitFor('document.querySelector("#code-error").textContent.includes("번호가 맞지")');}
  await waitFor('(async()=> (await window.connector.state()).stage === "authorization_required")()');await snapshot('desktop-code-exhausted');findings.push('five-wrong-codes-require-new-web-attempt');
  await closeOwnedWindow();await waitForExit(qa.pid);socket.close();
  findings.push('close-visible-expired-app-exits');
  await fixture('control',{mode:'ok'});
  qa.pid=await launch('qa-attempt-4');await writeFile(file,JSON.stringify(qa));client=await connect();
  await waitFor('(async()=> (await window.connector.state()).stage === "connected")()');
  await closeOwnedWindow();await pause(200);
  if(!alive(qa.pid))throw new Error('Closing an authorized window must preserve the current web connection');
  await fixture('control',{mode:'unauthorized'});await waitForExit(qa.pid);socket.close();
  findings.push('authorized-close-hides-until-web-ends','hidden-default-off-app-exits-on-401');
  await fixture('control',{mode:'short_lease'});
  qa.pid=await launch('qa-attempt-5');await writeFile(file,JSON.stringify(qa));client=await connect();
  await waitFor('(async()=> (await window.connector.state()).stage === "connected")()');
  await closeOwnedWindow();
  await fixture('control',{mode:'offline'});await waitForExit(qa.pid);socket.close();
  findings.push('hidden-default-off-app-exits-on-lease-expiry-with-network-loss');
  const finalStats=await fixture('stats');const proof={passed:true,findings,strictRejected:finalStats.strictRejected,uniqueDeviceCredentials:finalStats.fingerprints.length,pairRequests:finalStats.pair,actualInferenceRequests:0,capturedAt:new Date().toISOString()};
  await writeFile(join(artifacts,'desktop-recovery.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
} finally { if(socket?.readyState===WebSocket.OPEN){try{await client.js('window.connector.quit()')}catch{}} socket?.close(); }
