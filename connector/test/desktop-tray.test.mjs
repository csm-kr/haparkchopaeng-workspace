import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createConnectorTray } from '../desktop/tray.mjs';
import * as trayModule from '../desktop/tray.mjs';
import { stopBeforeExit } from '../core/lifetime.mjs';

function fixture({ platform = 'win32', fail = null, disabled = false } = {}) {
  const icons = [], instances = [], menus = [], events = [];
  class Tray extends EventEmitter {
    constructor(icon) {
      super();
      if (fail === 'create') throw new Error('Synthetic unavailable tray');
      this.icon = icon; this.destroyed = false; this.destroyCalls = 0; instances.push(this);
    }
    isDestroyed() { return this.destroyed; }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(value) { if (fail === 'menu') throw new Error('Synthetic unavailable menu'); this.menu = value; menus.push(value); }
    destroy() { this.destroyCalls += 1; this.destroyed = true; events.push('tray-destroy'); }
  }
  const nativeImage = { createFromPath(path) {
    icons.push(path);
    return { isEmpty: () => fail === 'image', resize(size) {
      return { path, size, template: false, setTemplateImage(value) { this.template = value; } };
    } };
  } };
  const controller = createConnectorTray({ Tray, Menu: { buildFromTemplate: template => template }, nativeImage,
    platform, disabled, productName: 'AI 브릿지', iconPath: 'assets/character.png',
    onOpen: () => events.push('open'), onQuit: () => events.push('quit') });
  return { controller, instances, menus, icons, events };
}

test('tray uses the supplied brand and replaceable icon with a safe initial status', () => {
  const { controller, instances, icons } = fixture();
  assert.equal(controller.available, true);
  assert.deepEqual(icons, ['assets/character.png']);
  assert.equal(instances[0].tooltip, 'AI 브릿지 · 연결 대기');
  assert.deepEqual(instances[0].menu.filter(item => item.label).map(item => item.label),
    ['AI 브릿지', '연결 대기', 'AI 브릿지 열기', 'AI 브릿지 종료']);
});

test('stage changes refresh only fixed Korean status text without opening a window or exposing input', () => {
  const { controller, instances, menus, events } = fixture();
  for (const [stage, label] of [['opening', '연결 확인'], ['pairing', '연결 확인'], ['connected', '연결됨'],
    ['recovering', '연결 복구 중'], ['authorization_required', '연결 중단'], ['error', '연결 오류'],
    ['private-account-123456-token', '연결 대기'], ['__proto__', '연결 대기']]) {
    assert.equal(controller.updateStage(stage), true);
    assert.equal(instances[0].tooltip, `AI 브릿지 · ${label}`);
    assert.equal(instances[0].menu[1].label, label);
  }
  const count = menus.length;
  controller.updateStage('idle');
  assert.equal(menus.length, count, 'Unchanged status must not rebuild the native menu on every heartbeat.');
  assert.deepEqual(events, []);
  assert.equal(JSON.stringify(menus).includes('private-account'), false);
});

test('only explicit open actions restore a window and quit callbacks cannot run twice', () => {
  const { controller, instances, events } = fixture();
  const tray = instances[0], previousMenu = tray.menu;
  previousMenu.find(item => item.label === 'AI 브릿지 열기').click();
  tray.emit('click');
  assert.deepEqual(events, ['open', 'open']);
  const quit = previousMenu.find(item => item.label === 'AI 브릿지 종료').click;
  quit(); quit();
  previousMenu.find(item => item.label === 'AI 브릿지 열기').click();
  tray.emit('click');
  controller.updateStage('connected');
  assert.deepEqual(events, ['open', 'open', 'quit']);
  assert.equal(tray.tooltip, 'AI 브릿지 · 종료 중');
  assert.ok(tray.menu.filter(item => item.click).every(item => item.enabled === false));
});

test('disposing twice removes native callbacks and makes stale menu callbacks inert', () => {
  const { controller, instances, events, menus } = fixture();
  const tray = instances[0], menu = tray.menu, count = menus.length;
  controller.dispose(); controller.dispose();
  assert.equal(controller.available, false);
  assert.equal(controller.updateStage('connected'), false);
  menu.find(item => item.label === 'AI 브릿지 열기').click();
  menu.find(item => item.label === 'AI 브릿지 종료').click();
  tray.emit('click');
  assert.equal(tray.listenerCount('click'), 0);
  assert.equal(tray.destroyCalls, 1);
  assert.equal(menus.length, count);
  assert.deepEqual(events, ['tray-destroy']);
});

test('a missing icon or unsupported native tray stays unavailable and cleans any partial icon', () => {
  for (const fail of ['create', 'image', 'menu']) {
    const { controller, instances, events } = fixture({ fail });
    assert.equal(controller.available, false);
    assert.equal(controller.updateStage('connected'), false);
    controller.dispose(); controller.dispose();
    assert.ok(instances.every(tray => tray.destroyCalls === 1));
    assert.ok(events.every(event => event === 'tray-destroy'));
  }
  const disabled = fixture({ disabled: true });
  assert.equal(disabled.controller.available, false);
  assert.deepEqual(disabled.icons, []);
  assert.deepEqual(disabled.instances, []);
});

test('macOS keeps native menu-bar click behavior and sizes the replaceable image for the menu bar', () => {
  const { instances, events } = fixture({ platform: 'darwin' });
  assert.deepEqual(instances[0].icon.size, { width: 18, height: 18 });
  assert.equal(instances[0].icon.template, true);
  instances[0].emit('click');
  assert.deepEqual(events, []);
  instances[0].menu.find(item => item.label === 'AI 브릿지 열기').click();
  assert.deepEqual(events, ['open']);
});

test('shutdown initiated outside the tray disables stale menu actions too', () => {
  const { controller, instances, events } = fixture();
  const menu = instances[0].menu;
  controller.updateStage('quitting');
  menu.find(item => item.label === 'AI 브릿지 열기').click();
  menu.find(item => item.label === 'AI 브릿지 종료').click();
  assert.deepEqual(events, []);
});

test('shutdown waits for CLI cancellation and monitoring cleanup before destroying the tray and exiting', async () => {
  const { controller, events } = fixture();
  let finishCli, finishMonitoring;
  const cli = new Promise(resolve => { finishCli = resolve; });
  const monitoring = new Promise(resolve => { finishMonitoring = resolve; });
  const pending = trayModule.shutdownWithTray({ tray: controller, exit: () => events.push('exit'),
    cleanup: () => stopBeforeExit({ runtime: { stop() { events.push('cancel-cli'); }, whenIdle() { return cli; } },
      stopMonitoring() { events.push('cancel-monitor'); return monitoring; }, exit() {} }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['cancel-cli', 'cancel-monitor']);
  finishCli();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.available, true);
  finishMonitoring(); await pending;
  assert.deepEqual(events, ['cancel-cli', 'cancel-monitor', 'tray-destroy', 'exit']);
});

test('shutdown still destroys the tray and exits when cleanup throws', async () => {
  const { controller, events } = fixture();
  await assert.rejects(trayModule.shutdownWithTray({ tray: controller,
    cleanup() { throw new Error('Synthetic cleanup failure'); }, exit() { events.push('exit'); } }), /Synthetic cleanup failure/);
  assert.deepEqual(events, ['tray-destroy', 'exit']);
});

test('only a live Windows or Mac tray can authorize hiding an active connection window', () => {
  const connected = { authorized: true, trayAvailable: true, quitting: false };
  for (const platform of ['win32', 'darwin']) {
    assert.equal(trayModule.shouldHideWindowToTray({ ...connected, platform }), true);
    for (const change of [{ authorized: false }, { trayAvailable: false }, { quitting: true }]) {
      assert.equal(trayModule.shouldHideWindowToTray({ ...connected, platform, ...change }), false);
    }
  }
  // A Linux Tray object does not prove a visible AppIndicator host exists.
  for (const trayAvailable of [false, true]) {
    assert.equal(trayModule.shouldHideWindowToTray({ ...connected, platform: 'linux', trayAvailable }), false);
  }
});

test('the native tray module is included in every packaged desktop without changing stable identity', async () => {
  const pkg = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.build.files.includes('tray.mjs'));
  assert.equal(pkg.stableProfileName, '하박조팽 연결기');
  assert.equal(pkg.build.appId, 'kr.hapark.connector');
});
