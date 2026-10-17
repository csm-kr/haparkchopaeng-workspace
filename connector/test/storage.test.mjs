import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentialStore } from '../core/storage.mjs';

test('device credential store encrypts secrets, round-trips app isolation and refuses insecure protector', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hapark-storage-test-'));
  const file = join(directory, 'devices.json');
  const protector = { available: () => true, encrypt: value => Buffer.from(value).map(x => x ^ 197), decrypt: value => Buffer.from(value).map(x => x ^ 197).toString() };
  try {
    const store = createCredentialStore(file, protector);
    const identity = { deviceToken: 'a'.repeat(43), deviceId: 'device-1', deviceName: 'this pc', platform: 'windows' };
    await store.save('one', identity);
    assert.deepEqual(await store.load('one'), identity);
    assert.equal(await store.load('two'), null);
    assert.equal((await readFile(file, 'utf8')).includes(identity.deviceToken), false);
    await assert.rejects(createCredentialStore(file, { ...protector, available: () => false }).save('one', identity));
    await store.remove('one');
    assert.equal(await store.load('one'), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
