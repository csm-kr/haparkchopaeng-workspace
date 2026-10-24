import test from 'node:test';
import assert from 'node:assert/strict';
import { runPetRendererQa } from '../scripts/pet-qa.mjs';

test('real isolated ImageGen pet renders actual state modes, typing frames, contrast, reduced motion and drag coverage',
  { skip: process.env.CONNECTOR_PET_NATIVE_QA !== '1', timeout: 180_000 }, async () => {
    const result = await runPetRendererQa();
    assert.equal(result.passed, true, JSON.stringify(result.checks.filter(item => !item.passed)));
    assert.equal(result.cliRequests, 0); assert.equal(result.accountProfileRead, false);
    assert.equal(typeof result.motionEnvironment.hostPrefersReducedMotion, 'boolean');
    assert.equal(result.motionEnvironment.normalPrefersReducedMotion, false);
    assert.ok(result.motionEnvironment.normalAnimationCount >= 3);
    assert.equal(result.motionEnvironment.normalAnimationsPending, 0);
  });
