/** Isolated Electron renderer QA. Loads only pet.html; no product main, accounts, CLI, protocols or web origin. */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, unlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url), connector = dirname(dirname(script));
const execute = promisify(execFile), delay = ms => new Promise(done => setTimeout(done, ms));
const taskTemporary = join(tmpdir(), 'hapark-ai-pet-20261018');

function inside(value, parent) { const part = relative(parent, value); assert.ok(part && !part.startsWith('..') && !isAbsolute(part)); }
async function safeDirectory(directory, parent) {
  inside(directory, parent);
  const parts = relative(parent, directory).split(/[\\/]/), canonicalParent = await realpath(parent);
  let cursor = parent;
  for (const part of parts) {
    cursor = join(cursor, part);
    try { await mkdir(cursor, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await lstat(cursor); assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); inside(await realpath(cursor), canonicalParent);
  }
  return realpath(directory);
}

export async function runPetRendererQa({ evidenceDirectory = join(connector, 'artifacts', `pet-renderer-${process.platform}`), dependenciesRoot = join(connector, 'desktop') } = {}) {
  evidenceDirectory = resolve(evidenceDirectory);
  const allowed = [join(connector, 'artifacts'), taskTemporary].some(parent => {
    const part = relative(resolve(parent), evidenceDirectory); return part && !part.startsWith('..') && !isAbsolute(part);
  });
  assert.ok(allowed, 'Evidence must stay in a task-owned output directory.');
  const temporaryRoot = await safeDirectory(taskTemporary, tmpdir());
  const artifacts = join(connector, 'artifacts');
  const taskPart = relative(taskTemporary, evidenceDirectory);
  const evidenceParent = taskPart.startsWith('..') || isAbsolute(taskPart) ? await safeDirectory(artifacts, connector) : taskTemporary;
  evidenceDirectory = await safeDirectory(evidenceDirectory, evidenceParent);
  for (const name of ['result.json', 'light-neutral.png', 'dark-neutral.png', 'light-tip-quarter.png', 'dark-tip-quarter.png', 'eyes-closed.png', 'spontaneous-smile.png', 'hover-handle.png', 'native-hover.png', 'reduced-motion-reaction.png']) await unlink(join(evidenceDirectory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const owned = await mkdtemp(join(temporaryRoot, 'renderer-')); await mkdir(join(owned, 'profile')); await mkdir(join(owned, 'session'));
  let child, exited = false, closed = false, forcedCleanup = false, receipt, exitCode = null, profileRemoved = false;
  try {
    const packageDirectory = join(resolve(dependenciesRoot), 'node_modules/electron');
    try { await access(join(packageDirectory, 'path.txt')); }
    catch (error) {
      // A borrowed QA runtime is read-only; install only into this worktree's own dependencies.
      if (resolve(dependenciesRoot) !== join(connector, 'desktop')) throw error;
      await execute(process.execPath, [join(packageDirectory, 'install.js')], { windowsHide: true, shell: false, timeout: 120_000 });
    }
    const executable = join(packageDirectory, 'dist', (await readFile(join(packageDirectory, 'path.txt'), 'utf8')).trim());
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(executable, [script, '--pet-native-qa', owned, evidenceDirectory], { windowsHide: true, shell: false, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = []; child.stdout.on('data', value => stdout.push(value)); child.stderr.on('data', value => stderr.push(value));
    child.once('exit', () => { exited = true; });
    const completion = new Promise(done => { child.once('error', () => { closed = true; done(1); }); child.once('close', code => { closed = true; done(code); }); });
    let timeout;
    const code = await Promise.race([completion, new Promise(done => { timeout = setTimeout(() => done(null), 60_000); })]).finally(() => clearTimeout(timeout));
    exitCode = code;
    assert.notEqual(code, null, 'PET_QA_TIMEOUT');
    await writeFile(join(evidenceDirectory, 'native.stdout.log'), Buffer.concat(stdout)); await writeFile(join(evidenceDirectory, 'native.stderr.log'), Buffer.concat(stderr));
    receipt = JSON.parse(await readFile(join(evidenceDirectory, 'result.json'), 'utf8'));
    receipt.cleanup = { ownedElectronExited: closed, exitCode: code, forcedCleanup: false, ownedProfileRemoved: false };
    return receipt;
  } finally {
    if (child?.pid && !exited && !closed) {
      forcedCleanup = true;
      // ChildProcess owns the native process handle. Never rebind an observed numeric PID.
      child.kill('SIGTERM');
      for (let count = 0; count < 100 && !closed; count += 1) await delay(50);
    }
    if ((closed && !forcedCleanup) || !child) {
      try { inside(owned, temporaryRoot); assert.equal(relative(await realpath(owned), owned), ''); assert.equal((await lstat(owned)).isSymbolicLink(), false); await rm(owned, { recursive: true }); profileRemoved = true; } catch { /* Retain an unconfirmed or redirected QA profile. */ }
    }
    if (!closed) { child?.stdout.destroy(); child?.stderr.destroy(); child?.unref(); }
    if (receipt) {
      receipt.cleanup = { ownedElectronExited: exited && closed, exitCode, forcedCleanup, ownedProfileRemoved: profileRemoved };
      receipt.passed &&= exited && closed && exitCode === 0 && !forcedCleanup && profileRemoved;
      await writeFile(join(evidenceDirectory, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
    }
  }
}

async function nativePetQa() {
  const { app, BrowserWindow, screen } = await import('electron');
  const flagIndex = process.argv.indexOf('--pet-native-qa');
  assert.ok(flagIndex >= 0 && process.argv.length === flagIndex + 3, 'Expected exactly two native QA directories.');
  const owned = resolve(process.argv[flagIndex + 1]), evidenceDirectory = resolve(process.argv[flagIndex + 2]);
  inside(owned, await realpath(taskTemporary));
  app.setName('AI Bridge isolated pet renderer QA'); app.setPath('userData', join(owned, 'profile')); app.setPath('sessionData', join(owned, 'session'));
  void app.whenReady().then(async () => {
    const receipt = { passed: false, mode: 'isolated-real-electron-pet-renderer', platform: process.platform,
      checks: [], screenshots: [], focusRequested: false, focusObserved: false, productMainLoaded: false,
      protocolRegistration: false, accountProfileRead: false, cliRequests: 0, rendererNetworkRequests: 0,
      nativePointer: { supported: process.platform === 'win32', observed: false, cursorRestored: false },
      limits: ['Synthetic display modes, not authenticated execution or an installed app.',
        'Native cursor hover is observed on Windows; other platforms use explicit Chromium hover state.',
        'Clicks are Chromium input events sent to the window, not OS pointer clicks.',
        'Physical OS dragging is not performed.'] };
    let win;
    const check = async (name, callback) => {
      try { receipt.checks.push({ name, passed: true, details: await callback() ?? null }); }
      catch (error) { receipt.checks.push({ name, passed: false, error: { name: error.name, message: error.message.slice(0, 320) } }); }
    };
    try {
      const work = screen.getPrimaryDisplay().workArea;
      win = new BrowserWindow({ width: 104, height: 144, x: work.x + 32, y: work.y + 48,
        frame: false, transparent: true, show: false, focusable: false, acceptFirstMouse: true, alwaysOnTop: true, skipTaskbar: true,
        webPreferences: { preload: join(connector, 'desktop/pet-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      win.on('focus', () => { receipt.focusObserved = true; });
      win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => { receipt.rendererNetworkRequests += 1; done({ cancel: true }); });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', event => event.preventDefault());
      await win.loadFile(join(connector, 'desktop/renderer/pet.html')); win.showInactive();
      const js = expression => win.webContents.executeJavaScript(expression);
      const frame = () => js('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      const pause = time => js(`Promise.all(document.getAnimations().map(async animation=>{animation.pause();await animation.ready;animation.currentTime=${time}}))`);
      const seek = async (name, time) => { await pause(0); await js(`document.getAnimations().find(a=>a.animationName===${JSON.stringify(name)}).currentTime=${time}`); await frame(); };
      const setMode = async mode => {
        win.webContents.send('connector:pet-state', mode);
        for (let n = 0; n < 30; n++) { await frame(); if (await js(`document.body.dataset.mode===${JSON.stringify(mode)}`)) return; await delay(10); }
        assert.fail(`Mode ${mode} did not arrive through the production preload.`);
      };
      const screenshot = async name => {
        await frame(); const image = await win.webContents.capturePage();
        await writeFile(join(evidenceDirectory, name), image.toPNG()); receipt.screenshots.push(name); return image;
      };
      const bitmap = image => ({ data: image.toBitmap({ scaleFactor: 1 }), size: image.getSize(1) });
      const pixel = (image, x, y) => {
        const { data, size } = bitmap(image);
        const offset = (Math.floor(y * size.height / 144) * size.width + Math.floor(x * size.width / 104)) * 4;
        return [...data.subarray(offset, offset + 4)];
      };
      const changed = (a, b) => {
        const first = bitmap(a), second = bitmap(b); assert.deepEqual(first.size, second.size);
        let count = 0;
        for (let p = 0; p < first.data.length; p += 4) if ([0, 1, 2].reduce((sum, i) => sum + Math.abs(first.data[p + i] - second.data[p + i]), 0) > 40) count++;
        return count;
      };
      win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('DOM.enable'); await win.webContents.debugger.sendCommand('CSS.enable');
      const doc = await win.webContents.debugger.sendCommand('DOM.getDocument');
      const hoverNodes = await Promise.all(['body', '.bri'].map(selector => win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector })));
      const hover = value => Promise.all(hoverNodes.map(({ nodeId }) => win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: value ? ['hover'] : [] })));
      const handleOpacity = () => js("Number(getComputedStyle(document.querySelector('.move-handle')).opacity)");
      const reaction = () => js('document.body.dataset.reaction ?? null');
      const click = async (x = 52, y = 72) => {
        const before = await reaction();
        for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
        for (let n = 0; n < 30; n++) { await frame(); const now = await reaction(); if (now && now !== before) return now; await delay(10); }
        assert.fail('A click on Bri did not reach the page.');
      };
      // A synthetic click leaves Chromium's pointer over the window, which keeps :hover on.
      const pointerLeave = async () => { win.webContents.sendInputEvent({ type: 'mouseLeave', x: -1, y: -1 }); await delay(200); await frame(); };
      const reactionEnded = async () => { for (let n = 0; n < 200; n++) { if (!(await reaction())) return; await delay(10); } assert.fail('The click reaction did not end.'); };
      const mouth = () => js(`({smile:Number(getComputedStyle(document.querySelector('.bri-greeting')).opacity),flat:1-Number(getComputedStyle(document.querySelector('.bri-greeting')).opacity)})`);
      const neutralMouth = async () => assert.ok((await mouth()).smile < .05);
      receipt.motionEnvironment = { hostPrefersReducedMotion: await js('matchMedia("(prefers-reduced-motion: reduce)").matches') };
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await setMode('idle'); await pause(0); await frame();
      Object.assign(receipt.motionEnvironment, await js(`({normalPrefersReducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,normalAnimationCount:document.getAnimations().length,normalAnimationsPending:document.getAnimations().filter(a=>a.pending).length})`));
      await check('PET_RECEIVE_ONLY_SANDBOX_AND_LOCAL_ASSETS', async () => {
        const observed = await js(`({node:typeof require,connector:typeof window.connector,api:Object.keys(window.bri),scripts:[...document.scripts].map(s=>s.getAttribute('src')),csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,drag:getComputedStyle(document.body).webkitAppRegion,loaded:performance.getEntriesByType('resource').map(r=>r.name)})`);
        const prefs = win.webContents.getLastWebPreferences();
        assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
        assert.equal(observed.node, 'undefined'); assert.equal(observed.connector, 'undefined'); assert.deepEqual(observed.api, ['onState']);
        assert.deepEqual(observed.scripts, ['pet.js']); assert.match(observed.csp, /connect-src 'none'/); assert.match(observed.csp, /script-src 'self'/);
        assert.notEqual(observed.drag, 'drag'); assert.match(await js("getComputedStyle(document.querySelector('.sprite')).backgroundImage"), /sprites-v2\.webp/);
        assert.equal(receipt.rendererNetworkRequests, 0);
        return { readOnlyApi: observed.api, remoteRequests: 0 };
      });
      await check('PET_FACE_AND_SILHOUETTE_ON_LIGHT_AND_DARK_AT_NATIVE_SCALE', async () => {
        const samples = [];
        for (const [background, name] of [['#ffffff', 'light-neutral.png'], ['#101216', 'dark-neutral.png']]) {
          await js(`document.body.style.background=${JSON.stringify(background)}`); await frame();
          const image = await screenshot(name), face = pixel(image, 50, 48), leftPlug = pixel(image, 18, 64), rightPlug = pixel(image, 88, 64);
          assert.ok(Math.max(...face.slice(0, 3)) < 90 && face[3] === 255);
          samples.push({ background, face, leftPlug, rightPlug, capturedSize: image.getSize(1), cssViewport: { width: 104, height: 144 } });
        }
        for (const part of ['face', 'leftPlug', 'rightPlug']) assert.ok(samples[0][part].every((value, i) => Math.abs(value - samples[1][part][i]) <= 10), `Character paint ${part} must retain contrast across backgrounds.`);
        return samples;
      });
      await check('PET_RENDERED_BLINK_6000MS', async () => {
        await pause(0); const open = await screenshot('eyes-open.png');
        await seek('bri-blink', 3000); const closed = await screenshot('eyes-closed.png');
        const x = await js(`parseFloat(getComputedStyle(document.querySelector('.sprite')).backgroundPositionX)`);
        assert.ok(Math.abs(x - 33.333333) < .01); assert.ok(changed(open, closed) > 8);
        await pause(0); return { periodMs: 6000, changedPixels: changed(open, closed) };
      });
      await check('PET_SPONTANEOUS_GREETING_14000MS', async () => {
        await pause(12320); await frame(); assert.ok((await mouth()).smile > .9); assert.ok(Number(await js("getComputedStyle(document.querySelector('.sprite')).opacity")) < .05); await screenshot('spontaneous-smile.png');
        await pause(0); await neutralMouth(); return { periodMs: 14000 };
      });
      await check('PET_HOVER_SHOWS_MOVE_HANDLE_WITHOUT_REACTING', async () => {
        assert.ok(await handleOpacity() < .05);
        await hover(true); await delay(200); await frame(); assert.ok(await handleOpacity() > .95); await neutralMouth(); assert.equal(await reaction(), null); await screenshot('hover-handle.png');
        await hover(false); await delay(200); await frame(); assert.ok(await handleOpacity() < .05); return { chromiumHoverState: true, handleHiddenAfterHover: true };
      });
      await check('PET_CLICK_PLAYS_A_RANDOM_REACTION_AND_RETURNS', async () => {
        const reactions = ['wave', 'jump', 'giggle', 'dance', 'wink'], seen = [];
        await pause(0); const idle = await screenshot('reaction-before.png');
        const first = await click(); assert.ok(reactions.includes(first)); seen.push(first);
        await frame(); const posed = await screenshot(`reaction-${first}.png`); assert.ok(changed(idle, posed) > 8);
        const second = await click(); assert.ok(reactions.includes(second)); assert.notEqual(second, first); seen.push(second);
        await reactionEnded(); await pointerLeave(); await pause(0); await frame(); assert.ok(changed(idle, await screenshot('reaction-after.png')) <= 8, 'Bri must return to the idle pose.');
        return { seen, returnedToIdle: true };
      });
      if (process.platform === 'win32') await check('PET_WINDOWS_NATIVE_CURSOR_HOVER', async () => {
        const nativeCursor = async point => { const source = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class PetQaCursor{[StructLayout(LayoutKind.Sequential)]public struct Point{public int X;public int Y;}[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern bool GetCursorPos(out Point p);}'; ${point ? `if(-not [PetQaCursor]::SetCursorPos(${point.x},${point.y})){exit 1};` : ''}$p=New-Object PetQaCursor+Point;if(-not [PetQaCursor]::GetCursorPos([ref]$p)){exit 1};[Console]::Write(('{"x":'+$p.X+',"y":'+$p.Y+'}'))`; const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true, shell: false, timeout: 10_000 }); return JSON.parse(result.stdout); };
        const bounds = win.getBounds(), target = { x: bounds.x + 52, y: bounds.y + 72 };
        const originalPhysical = await nativeCursor(), targetPhysical = screen.dipToScreenPoint(target);
        receipt.nativePointer.dipConvertedToPhysical = true;
        try {
          await nativeCursor(targetPhysical); await delay(100); await frame();
          receipt.nativePointer.observed = await js(`document.querySelector('[role="img"]').matches(':hover')`);
          await delay(200); receipt.nativePointer.handleObserved = await handleOpacity() > .95;
          await screenshot('native-hover.png'); assert.equal(receipt.nativePointer.observed, true); assert.equal(receipt.nativePointer.handleObserved, true);
        } finally {
          const current = screen.getCursorScreenPoint();
          if (Math.abs(current.x - target.x) <= 1 && Math.abs(current.y - target.y) <= 1) { const restored = await nativeCursor(originalPhysical); receipt.nativePointer.cursorRestored = restored.x === originalPhysical.x && restored.y === originalPhysical.y; }
        }
        assert.equal(receipt.nativePointer.cursorRestored, true);
      });
      await check('PET_WORKING_TWO_RENDERED_FRAMES_AND_PERSISTENT_LABEL', async () => {
        await setMode('working'); await pause(0); const first = await screenshot('working-a.png');
        await seek('bri-type', 450); const second = await screenshot('working-b.png');
        assert.ok(changed(first, second) > 8);
        const value = await js(`({label:document.querySelector('#pet-status').textContent,opacity:getComputedStyle(document.querySelector('#pet-status')).opacity,name:document.querySelector('.bri').getAttribute('aria-label')})`);
        assert.equal(value.label, '일하는 중'); assert.equal(value.opacity, '1'); assert.match(value.name, /일하는 브리/);
        await hover(true); await frame(); assert.ok((await mouth()).smile < .05); await hover(false);
        const pose = () => js("getComputedStyle(document.querySelector('.sprite')).backgroundPosition");
        const workingPose = await pose(); assert.equal(await click(), 'boop'); assert.equal(await pose(), workingPose); await reactionEnded(); await pointerLeave();
        return { ...value, changedPixels: changed(first, second), hoverKeepsWorkVisible: true, clickKeepsWorkVisible: true };
      });
      await check('PET_ALL_MODES_AND_KOREAN_LABELS_FIT', async () => {
        const samples = [];
        for (const mode of ['idle', 'ready', 'connecting', 'working', 'recovering', 'disconnected', 'error']) {
          await setMode(mode); await pause(0); await frame();
          const value = await js(`(()=>{const text=document.querySelector('#pet-status'),r=text.getBoundingClientRect(),sprite=document.querySelector('.sprite'),s=getComputedStyle(sprite);return {mode:document.body.dataset.mode,label:text.textContent,pose:s.backgroundPosition,visible:Number(getComputedStyle(text).opacity),fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&text.scrollWidth<=text.clientWidth}})()`);
          assert.equal(value.mode, mode); assert.equal(value.fits, true); if (!['idle', 'ready'].includes(mode)) assert.equal(value.visible, 1);
          await screenshot(`state-${mode}.png`); samples.push(value);
        }
        return samples;
      });
      await check('PET_REDUCED_MOTION_PRESERVES_STATIC_STATE_AND_HOVER', async () => {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        for (const mode of ['idle', 'working', 'recovering', 'disconnected']) {
          await setMode(mode); await frame();
          assert.equal(await js('document.getAnimations().filter(a=>a.playState==="running").length'), 0);
          await screenshot(`reduced-${mode}.png`);
        }
        await setMode('idle'); const posed = await click(); await frame();
        assert.equal(await js('document.getAnimations().filter(a=>a.playState==="running").length'), 0);
        assert.notEqual(await js("getComputedStyle(document.querySelector('.sprite')).backgroundPosition"), '0% 0%');
        await screenshot('reduced-motion-reaction.png'); await reactionEnded(); await pointerLeave();
        await hover(true); await frame(); assert.ok(await handleOpacity() > .95); await hover(false);
        return { repeatingAnimations: 0, staticWorkAndDisconnect: true, staticReaction: posed, handleWithoutTransition: true };
      });
      await check('PET_REAL_ELAPSED_BLINK_AND_GREETING_CYCLE', async () => {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await setMode('idle'); await pause(0); await frame();
        const value = await js(`new Promise(done=>{const started=performance.now(),result={floatIterationMs:null,floatOffset:null,floatX:null,floatRotation:null,blinkIterationMs:null,smileIterationMs:null,blinkPosition:null,smileOpacity:null};const finish=()=>{if(result.blinkIterationMs&&result.smileIterationMs){clearTimeout(timeout);document.removeEventListener('animationiteration',listener);done(result)}};const listener=event=>{if(event.animationName==='bri-float'&&!result.floatIterationMs)result.floatIterationMs=performance.now()-started;if(event.animationName==='bri-blink'&&!result.blinkIterationMs)result.blinkIterationMs=performance.now()-started;if(event.animationName==='bri-smile'&&!result.smileIterationMs)result.smileIterationMs=performance.now()-started;finish()};document.addEventListener('animationiteration',listener);document.getAnimations().forEach(a=>{a.currentTime=0;a.play()});setTimeout(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('.bri')).transform);result.floatOffset=Math.hypot(m.m41,m.m42);result.floatX=m.m41;result.floatRotation=Math.abs(m.m12)+Math.abs(m.m21)},3500);setTimeout(()=>{result.blinkPosition=parseFloat(getComputedStyle(document.querySelector('.sprite')).backgroundPositionX)},3000);setTimeout(()=>{result.smileOpacity=Number(getComputedStyle(document.querySelector('.bri-greeting')).opacity)},12320);const timeout=setTimeout(()=>{document.removeEventListener('animationiteration',listener);done(result)},15500)})`);
        receipt.elapsedObservation = value;
        assert.ok(value.floatIterationMs >= 5700 && value.floatIterationMs <= 6800);
        assert.ok(value.floatOffset > 1 && value.floatOffset <= 3.1);
        assert.ok(Math.abs(value.floatX) < .01 && value.floatRotation < .001);
        assert.ok(value.blinkIterationMs >= 5700 && value.blinkIterationMs <= 6800);
        assert.ok(value.smileIterationMs >= 13700 && value.smileIterationMs <= 14800);
        assert.ok(Math.abs(value.blinkPosition - 33.333333) < .01 && value.smileOpacity > .9);
        return { ...value, realElapsedCycleObserved: true };
      });
      await check('PET_MOTION_CONTINUITY_AND_LOOP_SEAM', async () => {
        await setMode('idle'); await seek('bri-float', 1500);
        const before = await js(`({phase:document.getAnimations().find(a=>a.animationName==='bri-float').currentTime,y:new DOMMatrix(getComputedStyle(document.querySelector('.bri')).transform).m42})`);
        await setMode('working'); await frame();
        const after = await js(`({phase:document.getAnimations().find(a=>a.animationName==='bri-float')?.currentTime,y:new DOMMatrix(getComputedStyle(document.querySelector('.bri')).transform).m42})`);
        assert.ok(Math.abs(after.phase-before.phase)<1 && Math.abs(after.y-before.y)<.01, 'Changing mode must not restart or teleport the idle motion.');
        await setMode('idle'); await pause(0); const start = await screenshot('loop-start.png');
        await pause(6000); const end = await screenshot('loop-end.png');
        assert.ok(changed(start, end) <= 8, 'The idle loop seam must return to the same rendered pose.');
        return { phasePreserved: true, loopSeamChangedPixels: changed(start, end) };
      });
      await check('PET_DRAG_AREA_FOCUS_AND_TRANSPARENT_MARGIN', async () => {
        await pause(0); await js("document.body.style.background='transparent'"); await frame(); const image = await screenshot('transparent-idle.png');
        const value = await js(`(()=>{const regions=[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).webkitAppRegion==='drag'&&getComputedStyle(e.parentElement).webkitAppRegion!=='drag');return {drag:regions.map(e=>e.className),area:regions.map(e=>e.offsetWidth*e.offsetHeight).reduce((a,b)=>a+b,0)}})()`);
        assert.deepEqual(value.drag, ['move-handle']); assert.ok(Math.abs(value.area - 484) < 1); assert.equal(receipt.focusObserved, false); assert.equal(win.isFocused(), false);
        assert.ok(pixel(image, 2, 2)[3] < 10);
        return { dragAreaRatio: Number((value.area / (104 * 144)).toFixed(3)), physicalDragPerformed: false, transparentCorner: true };
      });
      receipt.passed = receipt.checks.every(item => item.passed);
    } catch (error) { receipt.bootstrapFailed = { message: error.message.slice(0, 320) }; }
    finally {
      if (win && !win.isDestroyed()) win.destroy();
      await writeFile(join(evidenceDirectory, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
      app.exit(receipt.passed ? 0 : 1);
    }
  }).catch(() => app.exit(1));
}

if (process.versions.electron) { try { await nativePetQa(); } catch { const { app } = await import('electron'); app.exit(1); } }
else if (resolve(process.argv[1] ?? '') === script) {
  const options = {};
  for (const option of process.argv.slice(2)) {
    const match = /^(--evidence-dir|--dependencies-root)=(.+)$/.exec(option);
    assert.ok(match, 'Unexpected pet QA option.');
    const key = match[1] === '--evidence-dir' ? 'evidenceDirectory' : 'dependenciesRoot';
    assert.equal(Object.hasOwn(options, key), false, 'Duplicate pet QA option.'); options[key] = match[2];
  }
  const receipt = await runPetRendererQa(options);
  const finalReceipt = JSON.parse(await readFile(join(resolve(options.evidenceDirectory ?? join(connector, 'artifacts', `pet-renderer-${process.platform}`)), 'result.json'), 'utf8'));
  console.log(JSON.stringify(finalReceipt)); if (!receipt.passed) process.exitCode = 1;
}
