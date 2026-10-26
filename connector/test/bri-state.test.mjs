import assert from 'node:assert/strict';
import test from 'node:test';
import { BRI_PRESENTATIONS, BRI_REACTIONS, selectBriMode, selectBriReaction } from '../desktop/renderer/bri-state.mjs';

test('Bri follows actual job occupancy without inferring success after a job ends', () => {
  const session = { status: 'connected', currentJobId: null };
  assert.equal(selectBriMode({ stage: 'connected', runtime: session }), 'ready');
  session.currentJobId = 'a-real-job';
  assert.equal(selectBriMode({ stage: 'connected', runtime: session }), 'working');
  for (const outcome of ['completed', 'failed', 'cancelled']) {
    assert.equal(selectBriMode({ stage: 'connected', runtime: { ...session, currentJobId: null, outcome } }), 'ready');
  }
});

test('recovery, permission loss and new connection attempts override an old occupied job', () => {
  const job = { status: 'connected', currentJobId: 'old-job' };
  assert.equal(selectBriMode({ stage: 'connected', runtime: { ...job, status: 'recovering' } }), 'recovering');
  assert.equal(selectBriMode({ stage: 'connected', runtime: { ...job, status: 'authorization_required' } }), 'disconnected');
  assert.equal(selectBriMode({ stage: 'connected', runtime: { ...job, status: 'disconnected' } }), 'disconnected');
  for (const stage of ['opening', 'pairing']) assert.equal(selectBriMode({ stage, runtime: job }), 'connecting');
  assert.equal(selectBriMode({ stage: 'authorization_required', runtime: job }), 'disconnected');
  assert.equal(selectBriMode({ stage: 'error', runtime: job }), 'error');
  assert.equal(selectBriMode({ stage: 'idle', runtime: job }), 'idle');
  assert.equal(selectBriMode({ stage: 'connected' }), 'connecting');
});

test('each mode has a short fixed label and an accessible description', () => {
  for (const mode of ['idle', 'connecting', 'ready', 'working', 'recovering', 'disconnected', 'error']) {
    assert.ok(BRI_PRESENTATIONS[mode].label.length <= 8);
    assert.match(BRI_PRESENTATIONS[mode].accessibleLabel, /브리/);
  }
  assert.equal(BRI_PRESENTATIONS.working.label, '일하는 중');
});

test('a click picks a random pose reaction while idle or ready and never repeats the previous one', () => {
  assert.deepEqual([...BRI_REACTIONS], ['wave', 'jump', 'giggle', 'dance', 'wink']);
  for (const mode of ['idle', 'ready']) {
    const seen = new Set();
    for (const previous of [undefined, ...BRI_REACTIONS]) {
      for (const value of [0, .2, .4, .6, .8, .999999]) {
        const reaction = selectBriReaction({ mode, previous, random: () => value });
        assert.ok(BRI_REACTIONS.includes(reaction)); assert.notEqual(reaction, previous); seen.add(reaction);
      }
    }
    assert.equal(seen.size, BRI_REACTIONS.length);
  }
});

test('a click in a status mode only boops so the work or connection pose stays visible', () => {
  for (const mode of ['connecting', 'working', 'recovering', 'disconnected', 'error']) {
    assert.equal(selectBriReaction({ mode, previous: 'boop', random: () => .5 }), 'boop');
  }
});
