import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const port = Number(process.argv.find(value => value.startsWith('--port='))?.split('=')[1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Pass the owned Electron CDP port with --port=...');
const directory = resolve('artifacts'); await mkdir(directory, { recursive: true });
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(value => value.type === 'page' && /\/renderer\/index\.html$/.test(value.url));
if (!target || !target.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${port}/`)) throw new Error('Owned connector renderer not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0; const pending = new Map();
socket.addEventListener('message', event => { const message = JSON.parse(event.data); const request = pending.get(message.id); if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); } });
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
const js = async expression => { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
const waitFor = async (expression, timeout = 10000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await js(expression)) return; await new Promise(resolve => setTimeout(resolve,100)); } throw new Error(`Desktop condition not reached: ${expression}`); };
const capture = async name => { const value = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }); await writeFile(join(directory, `${name}.png`), Buffer.from(value.data,'base64')); };
const click = async selector => { const box = await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount:1, ...box }); await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount:1, ...box }); };
const typeCode = async value => { await js(`document.querySelector('#code').focus();document.querySelector('#code').select()`); await cdp('Input.insertText', { text: value }); };
try {
  // A CDP target exists before its stylesheet and character images finish loading.
  await waitFor(`document.readyState === 'complete' && [...document.images].every(image => image.complete && image.naturalWidth > 0)`);
  const checks = await js(`(async()=>({ stage:(await window.connector.state()).stage, background:getComputedStyle(document.body).backgroundColor, codeEmpty:document.querySelector('#code').value==='', codeDisabled:document.querySelector('#pair-button').disabled, autoStart:document.querySelector('#auto-start').checked, pet:document.querySelector('#pet').checked, nodeExposed:typeof window.require!=='undefined', focused:document.hasFocus(), overflow:document.documentElement.scrollWidth>innerWidth }))()`);
  if (checks.background !== 'rgb(14, 15, 12)' || !checks.codeEmpty || !checks.codeDisabled || checks.autoStart || checks.pet || checks.nodeExposed || checks.overflow || checks.focused) throw new Error(`Desktop baseline failed: ${JSON.stringify(checks)}`);
  await capture(`desktop-${checks.stage}`);
  const flow = [];
  if (process.argv.includes('--flow')) {
    if (checks.stage !== 'pairing') throw new Error('Start the app with a fresh fixture attempt before --flow');
    await typeCode('12345');
    if (!(await js('document.querySelector("#pair-button").disabled'))) throw new Error('Five digits must not enable pairing');
    await typeCode('123456'); await click('#pair-button');
    await waitFor('document.querySelector("#code-error").textContent.includes("번호가 맞지")');
    await capture('desktop-wrong-code'); flow.push('five-digits-disabled', 'wrong-six-digits-rejected');
    await typeCode('482107'); await click('#pair-button');
    await waitFor('(async()=> (await window.connector.state()).stage === "connected")()');
    await waitFor('document.querySelectorAll(".provider").length === 2', 40000);
    await capture('desktop-connected'); flow.push('correct-code-connected', 'actual-cli-metadata-visible');
    if (await js('!!document.querySelector(".quota-trigger")')) {
      const box = await js('(()=>{const r=document.querySelector(".quota-trigger").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
      await cdp('Input.dispatchMouseEvent', { type:'mouseMoved', ...box });
      await waitFor('document.querySelector(".quota-popover").hidden === false');
      await capture('desktop-quota-hover');
      await cdp('Input.dispatchMouseEvent', { type:'mouseMoved', x:15,y:15 });
      await waitFor('document.querySelector(".quota-popover").hidden === true'); flow.push('quota-hover-only');
    } else flow.push('unavailable-provider-state');
    const stats = (await (await fetch('http://127.0.0.1:3000/_qa/stats')).json()).data;
    if (stats.strictRejected !== 0 || stats.pair !== 2) throw new Error('Strict DTO or pair count mismatch');
    await writeFile(join(directory,'desktop-flow.json'),JSON.stringify({ passed:true, flow, stats:{ ack:stats.ack,pair:stats.pair,heartbeat:stats.heartbeat,strictRejected:stats.strictRejected,uniqueDeviceCredentials:stats.fingerprints.length }, capturedAt:new Date().toISOString() },null,2));
  }
  await writeFile(join(directory, 'desktop-qa.json'), JSON.stringify({ checks, capturedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, flow, screenshot: join(directory, `desktop-${checks.stage}.png`) }));
} finally { socket.close(); }
