import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldExitWithoutWeb, shouldOpenFirstWeb, stopBeforeExit } from '../core/lifetime.mjs';

const firstInstall = { packaged: true, launchRequested: false, hasAttempt: false, firstBrowserOpened: false, suppressAutoOpen: false };

test('first plain installed-app start opens the web connection flow', () => {
  assert.equal(shouldOpenFirstWeb(firstInstall), true);
});

test('a received link keeps its connection or failure screen after the launch queue drains', () => {
  assert.equal(shouldOpenFirstWeb({ ...firstInstall, launchRequested: true }), false);
  assert.equal(shouldOpenFirstWeb({ ...firstInstall, launchRequested: true, hasAttempt: true }), false);
});

test('development, an already opened first browser and an active attempt do not auto-open a web page', () => {
  for (const override of [{ packaged: false }, { firstBrowserOpened: true }, { suppressAutoOpen: true }, { hasAttempt: true }]) {
    assert.equal(shouldOpenFirstWeb({ ...firstInstall, ...override }), false);
  }
});

test('default off exits after hidden window loses web authorization, visible reconnect UI stays', () => {
  assert.equal(shouldExitWithoutWeb({ authorized: false, windowVisible: false, autoStart: false, pet: false }),true);
  assert.equal(shouldExitWithoutWeb({ authorized: false, windowVisible: true, autoStart: false, pet: false }),false);
  assert.equal(shouldExitWithoutWeb({ authorized: true, windowVisible: false, autoStart: false, pet: false }),false);
});
test('only explicitly selected autostart or pet retains background state', () => {
  assert.equal(shouldExitWithoutWeb({ authorized:false, windowVisible:false, autoStart:true, pet:false }),false);
  assert.equal(shouldExitWithoutWeb({ authorized:false, windowVisible:false, autoStart:false, pet:true }),false);
});
test('exit waits until active CLI cancellation and metadata cleanup have settled', async () => {
  const events=[];let finish;
  const pending=new Promise(resolve=>{finish=()=>{events.push('cli-stopped');resolve()}});
  const stopped=stopBeforeExit({runtime:{stop(){events.push('cancel')},whenIdle(){return pending}},stopMonitoring(){events.push('metadata-cancel');return Promise.resolve()},exit(){events.push('exit')}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(events.includes('exit'),false);
  finish();await stopped;assert.deepEqual(events,['cancel','metadata-cancel','cli-stopped','exit']);
});
