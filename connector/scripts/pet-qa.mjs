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

// Two real backdrops separate opaque ink from antialiasing, glow and shadow.
// Geometry and paint colors come from the rendered SVG, never a fixed RGB cutoff.
function inspectAntennaRim(light, dark, tip) {
  assert.deepEqual(light.size, dark.size);
  assert.ok(light.backgroundRgb.every((value, index) => value - dark.backgroundRgb[index] > 200));
  const limits = { minimumInkAlpha: .6, minimumGraphiteShare: .75, maximumColorResidual: 16 };
  const rimPixels = { top: 0, left: 0, right: 0 }, examples = { top: [], left: [], right: [] };
  const delta = tip.accentRgb.map((value, index) => value - tip.graphiteRgb[index]);
  const glowDelta = tip.glowRgb.map((value, index) => value - tip.graphiteRgb[index]);
  const accentNorm = delta.reduce((sum, value) => sum + value * value, 0);
  const glowNorm = glowDelta.reduce((sum, value) => sum + value * value, 0);
  const cross = delta.reduce((sum, value, index) => sum + value * glowDelta[index], 0);
  const determinant = accentNorm * glowNorm - cross * cross;
  assert.ok(determinant > 10000);
  const pixel = (image, x, y) => {
    const offset = (y * image.size.width + x) * 4;
    return [image.bitmap[offset + 2], image.bitmap[offset + 1], image.bitmap[offset], image.bitmap[offset + 3]];
  };
  for (let y = Math.floor(tip.y - tip.radius - tip.rimWidth - 1); y <= Math.ceil(tip.y + tip.radius + tip.rimWidth + 1); y += 1) {
    for (let x = Math.floor(tip.x - tip.radius - tip.rimWidth - 1); x <= Math.ceil(tip.x + tip.radius + tip.rimWidth + 1); x += 1) {
      if (x < 0 || y < 0 || x >= light.size.width || y >= light.size.height) continue;
      const dx = x + .5 - tip.x, dy = y + .5 - tip.y, radius = Math.hypot(dx, dy);
      if (radius < tip.radius || radius > tip.radius + tip.rimWidth + .75) continue;
      const white = pixel(light, x, y), graphite = pixel(dark, x, y);
      if (white[3] !== 255 || graphite[3] !== 255) continue;
      const uncovered = [0, 1, 2].map(index => (white[index] - graphite[index]) / (light.backgroundRgb[index] - dark.backgroundRgb[index])).sort((a, b) => a - b)[1];
      const alpha = Math.max(0, Math.min(1, 1 - uncovered));
      if (alpha < limits.minimumInkAlpha) continue;
      const ink = [0, 1, 2].map(index => (white[index] - (1 - alpha) * light.backgroundRgb[index]) / alpha);
      // The existing SVG filter also paints the --fg halo. Fit that real third paint separately.
      const accentDot = ink.reduce((sum, value, index) => sum + (value - tip.graphiteRgb[index]) * delta[index], 0);
      const glowDot = ink.reduce((sum, value, index) => sum + (value - tip.graphiteRgb[index]) * glowDelta[index], 0);
      const accentShare = Math.max(0, Math.min(1, (accentDot * glowNorm - glowDot * cross) / determinant));
      const glowShare = Math.max(0, Math.min(1, (glowDot * accentNorm - accentDot * cross) / determinant));
      const graphiteShare = 1 - accentShare - glowShare;
      const residual = Math.hypot(...ink.map((value, index) => value - tip.graphiteRgb[index] - accentShare * delta[index] - glowShare * glowDelta[index]));
      if (graphiteShare < limits.minimumGraphiteShare || residual > limits.maximumColorResidual) continue;
      for (const [sector, matches] of [['top', dy < -tip.radius * .5], ['left', dx < -tip.radius * .5 && Math.abs(dy) < tip.radius], ['right', dx > tip.radius * .5 && Math.abs(dy) < tip.radius]]) {
        if (!matches) continue;
        rimPixels[sector] += 1;
        if (examples[sector].length < 3) examples[sector].push({ x, y, inkAlpha: Number(alpha.toFixed(3)), graphiteShare: Number(graphiteShare.toFixed(3)), glowShare: Number(glowShare.toFixed(3)), colorResidual: Number(residual.toFixed(3)) });
      }
    }
  }
  return { passed: Object.values(rimPixels).every(value => value > 0), rimPixels, limits, examples };
}

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
  for (const name of ['result.json', 'light-neutral.png', 'dark-neutral.png', 'light-tip-quarter.png', 'dark-tip-quarter.png', 'eyes-closed.png', 'spontaneous-smile.png', 'hover-smile.png', 'native-hover.png', 'reduced-motion-hover.png']) await unlink(join(evidenceDirectory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
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
  const { app, BrowserWindow, screen, nativeImage } = await import('electron');
  const flagIndex = process.argv.indexOf('--pet-native-qa');
  assert.ok(flagIndex >= 0 && process.argv.length === flagIndex + 3, 'Expected exactly two native QA directories.');
  const owned = resolve(process.argv[flagIndex + 1]), evidenceDirectory = resolve(process.argv[flagIndex + 2]);
  inside(owned, await realpath(taskTemporary));
  app.setName('AI Bridge isolated pet renderer QA'); app.setPath('userData', join(owned, 'profile')); app.setPath('sessionData', join(owned, 'session'));
  // Do not await ready at module top level: Electron waits for the ESM entry to finish.
  void app.whenReady().then(async () => {
    const receipt = { passed: false, mode: 'isolated-real-electron-pet-renderer', platform: process.platform,
      checks: [], screenshots: [], focusRequested: false, focusObserved: false, productMainLoaded: false,
      protocolRegistration: false, accountProfileRead: false, cliRequests: 0, rendererNetworkRequests: 0,
      nativePointer: { supported: process.platform === 'win32', observed: false, cursorRestored: false },
      limits: ['No installed app, authenticated account, real desktop wallpaper or packaged installer is used.',
        'Native cursor hover is observed on Windows; other platforms use explicit Chromium hover state.',
        'Drag coverage is checked from native renderer CSS; physical OS dragging is not performed.'] };
    let win;
    const check = async (name, callback) => { try { const details = await callback(); receipt.checks.push({ name, passed: true, details: details ?? null }); } catch (error) { receipt.checks.push({ name, passed: false, error: {
      name: error?.name === 'AssertionError' ? 'AssertionError' : 'Error',
      code: typeof error?.code === 'string' && /^ERR_[A-Z_]+$/.test(error.code) ? error.code : null,
      actual: ['number', 'boolean'].includes(typeof error?.actual) ? error.actual : null,
      expected: ['number', 'boolean'].includes(typeof error?.expected) ? error.expected : null,
    } }); } };
    try {
      const work = screen.getPrimaryDisplay().workArea;
      win = new BrowserWindow({ width: 104, height: 112, x: work.x + 32, y: work.y + 48,
        frame: false, transparent: true, show: false, focusable: false, alwaysOnTop: true, skipTaskbar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      receipt.qaWindowPlacement = { region: 'work-area-top-left', bounds: win.getBounds(), avoidsDefaultInstalledPetLocation: true };
      win.on('focus', () => { receipt.focusObserved = true; });
      win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => { receipt.rendererNetworkRequests += 1; done({ cancel: true }); });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', event => event.preventDefault());
      await win.loadFile(join(connector, 'desktop/renderer/pet.html')); win.showInactive();
      const js = expression => win.webContents.executeJavaScript(expression);
      const frame = () => js('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      const pause = time => js(`Promise.all(document.getAnimations().map(async animation=>{animation.pause();await animation.ready;animation.currentTime=${time}}))`);
      const screenshot = async name => { const image = await win.webContents.capturePage(); await writeFile(join(evidenceDirectory, name), image.toPNG()); receipt.screenshots.push(name); return image; };
      win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('DOM.enable'); await win.webContents.debugger.sendCommand('CSS.enable');
      const document = await win.webContents.debugger.sendCommand('DOM.getDocument');
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector: '[role="img"]' });
      const hover = value => win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: value ? ['hover'] : [] });
      const mouth = () => js(`(()=>{const smile=document.querySelector('.mouth-smile'),flat=document.querySelector('.mouth-flat');return {smile:smile?Number(getComputedStyle(smile).opacity):-1,flat:flat?Number(getComputedStyle(flat).opacity):-1}})()`);
      const neutralMouth = async () => { const value = await mouth(); assert.ok(value.smile < .05 && value.flat > .95); };
      receipt.motionEnvironment = { hostPrefersReducedMotion: await js('matchMedia("(prefers-reduced-motion: reduce)").matches') };
      // Normal-motion samples must not inherit an accessibility preference from the CI host.
      // The explicit reduce-mode check below still verifies that preference independently.
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await frame();
      await pause(0); await frame();
      Object.assign(receipt.motionEnvironment, await js(`({normalPrefersReducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,normalAnimationCount:document.getAnimations().length,normalAnimationsPending:document.getAnimations().filter(animation=>animation.pending).length})`));
      await check('PET_SECURITY_AND_DRAG_CONTRACT', async () => {
        const observed = await js(`({node:typeof require,script:document.querySelectorAll('script').length,csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,drag:getComputedStyle(document.body).webkitAppRegion})`);
        const prefs = win.webContents.getLastWebPreferences();
        assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
        assert.equal(observed.node, 'undefined'); assert.equal(observed.script, 0); assert.equal(observed.drag, 'drag');
        assert.equal(observed.csp, "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'");
      });
      await check('PET_OPAQUE_FACE_AND_PLUGS_ON_LIGHT_AND_DARK', async () => {
        const samples = [];
        for (const [background, name] of [['#ffffff', 'light-neutral.png'], ['#101216', 'dark-neutral.png']]) {
          await js(`document.body.style.background=${JSON.stringify(background)}`); await frame();
          const image = await screenshot(name), bitmap = image.toBitmap({ scaleFactor: 1 }), size = image.getSize(1);
          assert.equal(bitmap.length, size.width * size.height * 4);
          const pixel = (x, y) => [...bitmap.subarray((Math.round(y) * size.width + Math.round(x)) * 4, (Math.round(y) * size.width + Math.round(x)) * 4 + 4)];
          const face = pixel(52, 48), leftPlug = pixel(25, 56), rightPlug = pixel(80, 56);
          for (const value of [face, leftPlug, rightPlug]) assert.ok(Math.max(...value.slice(0, 3)) < 70 && value[3] === 255);
          samples.push({ background, face, leftPlug, rightPlug, bitmapScaleFactor: 1, representations: image.getScaleFactors() });
        }
        for (const name of ['face', 'leftPlug', 'rightPlug']) assert.ok(samples[0][name].every((value, index) => Math.abs(value - samples[1][name][index]) <= 2), 'Opaque parts must not depend on the background.');
        return samples;
      });
      await check('PET_ANTENNA_TIP_GRAPHITE_OUTLINE_ON_LIGHT_AND_DARK', async () => {
        const observation = { pixelFormat: 'BGRA8 converted to RGB', samples: [], originalRed: { checked: false } };
        receipt.antennaTipOutline = observation;
        const geometry = () => js(`(()=>{const dot=document.querySelector('svg > g:not(.outline) > circle[cx="24"][cy="5.5"]'),rim=document.querySelector('.outline > circle[cx="24"][cy="5.5"]');if(!dot||!rim)return null;const r=dot.getBoundingClientRect(),rgb=value=>value.match(/[\\d.]+/g).slice(0,3).map(Number),probe=document.createElementNS(dot.namespaceURI,'rect');probe.style.fill='var(--fg)';dot.ownerSVGElement.append(probe);const glowRgb=rgb(getComputedStyle(probe).fill);probe.remove();return {x:r.x+r.width/2,y:r.y+r.height/2,radius:r.width/2,rimWidth:Number.parseFloat(getComputedStyle(rim).strokeWidth)*r.width/(Number(dot.getAttribute('r'))*4),graphiteRgb:rgb(getComputedStyle(rim).stroke),accentRgb:rgb(getComputedStyle(dot).fill),glowRgb}})()`);
        const capturePair = async () => {
          const pair = [];
          for (const background of ['#ffffff', '#101216']) {
            await js(`document.body.style.background=${JSON.stringify(background)}`); await frame();
            const tip = await geometry(), image = await win.webContents.capturePage();
            const value = { image, tip, bitmap: image.toBitmap({ scaleFactor: 1 }), size: image.getSize(1), backgroundRgb: await js(`getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g).slice(0,3).map(Number)`) };
            assert.equal(value.bitmap.length, value.size.width * value.size.height * 4); pair.push(value);
          }
          assert.ok(pair[0].tip && pair[0].tip.radius > 3 && pair[0].tip.radius < 4);
          for (const field of ['x', 'y', 'radius', 'rimWidth']) assert.ok(Math.abs(pair[0].tip[field] - pair[1].tip[field]) < .001, 'Both backdrops must use the same rendered geometry.');
          return pair;
        };
        try {
          for (const offset of [0, .25]) {
            await js(`document.querySelector('.bri').style.translate='${offset}px ${offset}px'`); await frame();
            const pair = await capturePair(), positive = inspectAntennaRim(pair[0], pair[1], pair[0].tip);
            const sample = { offsetCssPx: offset, geometry: pair[0].tip, backgroundsRgb: pair.map(value => value.backgroundRgb), ...positive };
            observation.samples.push(sample);
            for (const [index, prefix] of ['light', 'dark'].entries()) {
              const name = offset ? `${prefix}-tip-quarter.png` : `${prefix}-neutral.png`;
              await writeFile(join(evidenceDirectory, name), pair[index].image.toPNG());
              if (offset) receipt.screenshots.push(name);
            }
            // A real rendered negative control rejects glow/shadow and cannot pass a missing outline.
            await js(`document.querySelector('.outline > circle').style.visibility='hidden'`); await frame();
            const withoutRim = await capturePair();
            sample.withoutOutline = inspectAntennaRim(withoutRim[0], withoutRim[1], pair[0].tip);
            await js(`document.querySelector('.outline > circle').style.visibility=''`); await frame();
            assert.equal(positive.passed, true, 'The painted tip must have graphite ink above and on both sides.');
            assert.equal(sample.withoutOutline.passed, false, 'A renderer without the tip outline must not pass.');
            if (!offset) {
              const reference = join(taskTemporary, 'outline-red'), names = ['light-neutral.png', 'dark-neutral.png'];
              try {
                const images = [];
                for (const [index, name] of names.entries()) {
                  const file = join(reference, name), stat = await lstat(file);
                  assert.ok(stat.isFile() && !stat.isSymbolicLink()); inside(await realpath(file), await realpath(taskTemporary));
                  const image = nativeImage.createFromBuffer(await readFile(file)); assert.equal(image.isEmpty(), false);
                  images.push({ bitmap: image.toBitmap({ scaleFactor: 1 }), size: image.getSize(1), backgroundRgb: pair[index].backgroundRgb });
                }
                assert.deepEqual(images[0].size, pair[0].size);
                observation.originalRed = { checked: true, geometrySource: 'same 104x112 viewport and unshifted 88px SVG', ...inspectAntennaRim(images[0], images[1], pair[0].tip) };
                assert.equal(observation.originalRed.passed, false, 'Original real RED captures must still fail.');
              } catch (error) { if (error.code !== 'ENOENT') throw error; }
            }
          }
        } finally {
          await js(`document.querySelector('.outline > circle').style.visibility='';document.querySelector('.bri').style.translate=''`); await frame();
        }
        return observation;
      });
      await check('PET_REAL_EYE_CLOSURE_6000MS', async () => {
        const observed = await js(`(()=>{const eye=document.querySelector('.eyes'),animation=document.getAnimations().find(item=>item.animationName==='bri-blink');if(!eye||!animation)return null;const duration=animation.effect.getTiming().duration;animation.pause();animation.currentTime=0;const open=eye.getBoundingClientRect().height;animation.currentTime=3000;const closed=eye.getBoundingClientRect().height;return {duration,open,closed}})()`);
        assert.equal(observed?.duration, 6000); assert.ok(observed.open > 5 && observed.closed < observed.open * .2); await frame(); await screenshot('eyes-closed.png'); await pause(0);
        return { periodMs: observed.duration, closedHeightRatio: Number((observed.closed / observed.open).toFixed(3)) };
      });
      await check('PET_SPONTANEOUS_SMILE_14000MS', async () => {
        await pause(0); await frame(); await neutralMouth();
        const observed = await js(`(()=>{const animation=document.getAnimations().find(item=>item.animationName==='bri-smile');if(!animation)return null;const duration=animation.effect.getTiming().duration;document.getAnimations().forEach(item=>{item.pause();item.currentTime=12320});return {duration}})()`);
        const value = await mouth(); assert.equal(observed?.duration, 14000); assert.ok(value.smile > .9 && value.flat < .1); await frame(); await screenshot('spontaneous-smile.png'); await pause(0); await frame(); await neutralMouth();
        return { periodMs: observed.duration, sampledAtMs: 12320, smileOpacity: value.smile };
      });
      await check('PET_RENDERER_HOVER_SMILE', async () => { await neutralMouth(); await hover(true); await frame(); const value = await mouth(); assert.ok(value.smile > .9 && value.flat < .1); await screenshot('hover-smile.png'); await hover(false); await pause(0); await frame(); await neutralMouth(); return { chromiumHoverState: true, neutralRestored: true }; });
      if (process.platform === 'win32') await check('PET_WINDOWS_NATIVE_CURSOR_HOVER', async () => {
        const nativeCursor = async point => { const source = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class PetQaCursor{[StructLayout(LayoutKind.Sequential)]public struct Point{public int X;public int Y;}[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern bool GetCursorPos(out Point p);}'; ${point ? `if(-not [PetQaCursor]::SetCursorPos(${point.x},${point.y})){exit 1};` : ''}$p=New-Object PetQaCursor+Point;if(-not [PetQaCursor]::GetCursorPos([ref]$p)){exit 1};[Console]::Write(('{"x":'+$p.X+',"y":'+$p.Y+'}'))`; const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true, shell: false, timeout: 10_000 }); return JSON.parse(result.stdout); };
        const bounds = win.getBounds(), target = { x: bounds.x + 52, y: bounds.y + 56 };
        const originalPhysical = await nativeCursor(), targetPhysical = screen.dipToScreenPoint(target);
        receipt.nativePointer.dipConvertedToPhysical = true;
        try {
          await nativeCursor(targetPhysical); await delay(100); await frame();
          receipt.nativePointer.observed = await js(`document.querySelector('[role="img"]').matches(':hover')`);
          const value = await mouth(); receipt.nativePointer.smileObserved = value.smile > .9 && value.flat < .1;
          await screenshot('native-hover.png'); assert.equal(receipt.nativePointer.observed, true); assert.equal(receipt.nativePointer.smileObserved, true);
        } finally {
          const current = screen.getCursorScreenPoint();
          if (Math.abs(current.x - target.x) <= 1 && Math.abs(current.y - target.y) <= 1) { const restored = await nativeCursor(originalPhysical); receipt.nativePointer.cursorRestored = restored.x === originalPhysical.x && restored.y === originalPhysical.y; }
        }
        assert.equal(receipt.nativePointer.cursorRestored, true);
      });
      await check('PET_REDUCED_MOTION_STATIC_HOVER', async () => {
        await hover(false); await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await frame();
        assert.equal(await js('document.getAnimations().filter(item=>item.playState==="running").length'), 0);
        await neutralMouth(); await hover(true); await frame(); const value = await mouth(); assert.ok(value.smile > .9 && value.flat < .1); await screenshot('reduced-motion-hover.png'); await hover(false); await frame(); await neutralMouth();
        return { repeatingAnimations: 0, staticHoverSmile: true };
      });
      await check('PET_REAL_ELAPSED_BLINK_AND_SMILE_CYCLE', async () => {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }); await frame();
        const observed = await js(`new Promise(done=>{const started=performance.now(),result={blinkIterationMs:null,smileIterationMs:null,closedEyeHeight:null,smileOpacity:null};const finish=()=>{if(result.blinkIterationMs&&result.smileIterationMs){clearTimeout(timeout);document.removeEventListener('animationiteration',listener);done(result)}};const listener=event=>{if(event.animationName==='bri-blink'&&!result.blinkIterationMs)result.blinkIterationMs=performance.now()-started;if(event.animationName==='bri-smile'&&!result.smileIterationMs)result.smileIterationMs=performance.now()-started;finish()};document.addEventListener('animationiteration',listener);document.getAnimations().forEach(animation=>{animation.currentTime=0;animation.play()});setTimeout(()=>{result.closedEyeHeight=document.querySelector('.eyes')?.getBoundingClientRect().height??null},3000);setTimeout(()=>{const mouth=document.querySelector('.mouth-smile');result.smileOpacity=mouth?Number(getComputedStyle(mouth).opacity):null},12320);const timeout=setTimeout(()=>{document.removeEventListener('animationiteration',listener);done(result)},15500)})`);
        assert.ok(observed.blinkIterationMs >= 5700 && observed.blinkIterationMs <= 6800);
        assert.ok(observed.smileIterationMs >= 13700 && observed.smileIterationMs <= 14800);
        assert.ok(observed.closedEyeHeight > 0 && observed.closedEyeHeight < 2 && observed.smileOpacity > .9);
        return { ...observed, realElapsedCycleObserved: true };
      });
      await check('PET_DRAG_AREA_AND_FOCUS_PRESERVED', async () => {
        const value = await js(`({drag:getComputedStyle(document.body).webkitAppRegion,area:[...document.querySelectorAll('*')].filter(item=>getComputedStyle(item).webkitAppRegion==='no-drag').map(item=>{const r=item.getBoundingClientRect();return r.width*r.height}).reduce((a,b)=>a+b,0)})`);
        assert.equal(value.drag, 'drag'); assert.ok(value.area <= 104 * 112 * .12); assert.equal(receipt.focusObserved, false); assert.equal(win.isFocused(), false);
        return { excludedDragAreaRatio: Number((value.area / (104 * 112)).toFixed(3)), physicalDragPerformed: false };
      });
      receipt.passed = receipt.checks.every(item => item.passed);
    } catch { receipt.bootstrapFailed = true; }
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
