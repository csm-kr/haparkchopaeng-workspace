import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldExitWithoutWeb, stopBeforeExit } from '../core/lifetime.mjs';

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
