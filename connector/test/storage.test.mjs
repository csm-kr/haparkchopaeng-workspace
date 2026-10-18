import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentialStore } from '../core/storage.mjs';
import { createDeviceIdentity } from '../core/security.mjs';

const protectorFor = key => ({
  available: () => true,
  encrypt: value => Buffer.concat([Buffer.from([key]), Buffer.from(value).map(byte => byte ^ key)]),
  decrypt: value => { if (value[0] !== key) throw new Error('Ciphertext cannot be decrypted'); return value.subarray(1).map(byte => byte ^ key).toString(); },
});

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

test('unreadable encrypted credentials are preserved and a fresh unpaired identity can be stored', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hapark-storage-recovery-'));
  const file = join(directory, 'devices.enc.json');
  const oldIdentity = { deviceToken: 'a'.repeat(43), deviceId: 'old-device', deviceName: 'this pc', platform: 'windows' };
  try {
    await createCredentialStore(file, protectorFor(197)).save('one', oldIdentity);
    const original = await readFile(file);
    const store = createCredentialStore(file, protectorFor(101));
    assert.equal(await store.load('one'), null);
    const names = await readdir(directory);
    assert.equal(names.length, 1);
    assert.match(names[0], /^devices\.enc\.json\.unreadable-[a-f0-9-]+\.enc\.bak$/);
    assert.deepEqual(await readFile(join(directory, names[0])), original);
    const fresh = createDeviceIdentity('win32');
    assert.equal(fresh.deviceId, null);
    assert.notEqual(fresh.deviceToken, oldIdentity.deviceToken);
    await store.save('one', fresh);
    assert.deepEqual(await store.load('one'), fresh);
    assert.equal((await readFile(file, 'utf8')).includes(fresh.deviceToken), false);
    assert.deepEqual(await readFile(join(directory, names[0])), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unavailable storage and denied decryption preserve the existing ciphertext without recovery', async () => {
  for (const failure of ['unavailable', 'locks-during-decrypt', 'EACCES', 'EPERM']) {
    const directory = await mkdtemp(join(tmpdir(), 'hapark-storage-denied-'));
    const file = join(directory, 'devices.enc.json');
    try {
      await createCredentialStore(file, protectorFor(197)).save('one', createDeviceIdentity('win32'));
      const original = await readFile(file);
      let isAvailable = failure !== 'unavailable', decryptCalls = 0;
      const denied = createCredentialStore(file, { ...protectorFor(197), available: () => isAvailable, decrypt: () => {
        decryptCalls += 1;
        if (failure === 'locks-during-decrypt') isAvailable = false;
        throw Object.assign(new Error('Access denied'), { code: failure });
      } });
      await assert.rejects(denied.load('one'));
      assert.equal(decryptCalls, failure === 'unavailable' ? 0 : 1);
      assert.deepEqual(await readFile(file), original);
      assert.deepEqual(await readdir(directory), ['devices.enc.json']);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('concurrent recovery, saves, loads and remove create one backup and preserve both new app identities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hapark-storage-queue-'));
  const file = join(directory, 'devices.enc.json');
  try {
    await createCredentialStore(file, protectorFor(197)).save('old', createDeviceIdentity('win32'));
    const original = await readFile(file);
    const store = createCredentialStore(file, protectorFor(101));
    const one = createDeviceIdentity('win32'), two = createDeviceIdentity('win32');
    const results = await Promise.allSettled([
      store.load('one'), store.load('two'), store.save('one', one), store.save('two', two),
      store.load('one'), store.remove('unused'), store.load('two'),
    ]);
    assert.equal(results.every(value => value.status === 'fulfilled'), true);
    assert.equal(results[0].value, null);
    assert.equal(results[1].value, null);
    assert.deepEqual(results[4].value, one);
    assert.deepEqual(results[6].value, two);
    const backups = (await readdir(directory)).filter(name => name.endsWith('.enc.bak'));
    assert.equal(backups.length, 1);
    assert.deepEqual(await readFile(join(directory, backups[0])), original);
    assert.deepEqual(await store.load('one'), one);
    assert.deepEqual(await store.load('two'), two);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('valid multi-app credentials keep their keys and one invalid app record does not move the vault', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hapark-storage-multi-app-'));
  const file = join(directory, 'devices.enc.json');
  try {
    const protector = protectorFor(197), one = createDeviceIdentity('win32'), two = createDeviceIdentity('win32');
    await writeFile(file, JSON.stringify({ version: 1, data: protector.encrypt(JSON.stringify({ one, two, broken: { ...one, deviceToken: 'invalid' } })).toString('base64') }), { mode: 0o600 });
    const original = await readFile(file), store = createCredentialStore(file, protector);
    await assert.rejects(store.load('broken'));
    assert.deepEqual(await readFile(file), original);
    assert.deepEqual(await store.load('one'), one);
    assert.deepEqual(await store.load('two'), two);
    await store.save('one', one); await store.remove('unused');
    assert.deepEqual(await store.load('one'), one);
    assert.deepEqual(await store.load('two'), two);
    assert.deepEqual(await readdir(directory), ['devices.enc.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unavailable or denied encryption leaves the original vault untouched and the queue can retry', async () => {
  for (const failure of ['locks-before-encrypt', 'encryption-denied']) {
    const directory = await mkdtemp(join(tmpdir(), 'hapark-storage-encrypt-denied-'));
    const file = join(directory, 'devices.enc.json');
    try {
      const protector = protectorFor(197), identity = createDeviceIdentity('win32');
      await createCredentialStore(file, protector).save('one', identity);
      const original = await readFile(file);
      let isAvailable = true, failOnce = true, encryptCalls = 0;
      const store = createCredentialStore(file, { ...protector, available: () => isAvailable,
        decrypt(value) { const decoded = protector.decrypt(value); if(failure === 'locks-before-encrypt' && failOnce){failOnce=false;queueMicrotask(() => { isAvailable=false; });} return decoded; },
        encrypt(value) { encryptCalls += 1; if(failure === 'encryption-denied' && failOnce){failOnce=false;throw Object.assign(new Error('Access denied'),{code:'EACCES'});} return protector.encrypt(value); },
      });
      await assert.rejects(store.save('two', createDeviceIdentity('win32')));
      assert.deepEqual(await readFile(file), original);
      assert.deepEqual(await readdir(directory), ['devices.enc.json']);
      assert.equal(encryptCalls, failure === 'locks-before-encrypt' ? 0 : 1);
      isAvailable = true; await store.save('one', identity);
      assert.deepEqual(await store.load('one'), identity);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('filesystem read errors never become ciphertext recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hapark-storage-io-error-'));
  const file = join(directory, 'devices.enc.json');
  try {
    await mkdir(file);
    let decryptCalls = 0;
    const store = createCredentialStore(file, { ...protectorFor(197), decrypt() { decryptCalls += 1; throw new Error('Must not decrypt after a filesystem failure'); } });
    await assert.rejects(store.load('one'));
    assert.equal(decryptCalls, 0);
    assert.deepEqual(await readdir(directory), ['devices.enc.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
