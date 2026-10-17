import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopAckInput, desktopPairInput } from '../core/protocol.mjs';

test('desktop ACK sends exactly strict server DTO fields, never stored deviceId or extras', () => {
  const launch = { attemptId: 'attempt-1', launchToken: 'a'.repeat(43), application: { private: true } };
  const identity = { deviceId: null, deviceToken: 'b'.repeat(43), deviceName: 'This PC', platform: 'windows', extra: 'must not leave device' };
  assert.deepEqual(desktopAckInput(launch, identity), { attemptId: launch.attemptId, launchToken: launch.launchToken, deviceToken: identity.deviceToken, deviceName: 'This PC', platform: 'windows' });
  assert.deepEqual(desktopPairInput(launch, identity, '012345'), { attemptId: launch.attemptId, launchToken: launch.launchToken, deviceToken: identity.deviceToken, code: '012345' });
});
