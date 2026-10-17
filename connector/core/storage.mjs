import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TOKEN_PATTERN, ID_PATTERN } from './security.mjs';

export function createCredentialStore(file, protector) {
  let operationChain = Promise.resolve();
  function serialize(operation) {
    const next = operationChain.catch(() => {}).then(operation);
    operationChain = next; return next;
  }
  const available = () => { if (!protector.available()) throw new Error('OS 보안 저장소를 사용할 수 없어요. 키체인 또는 보안 저장소를 켠 뒤 다시 연결해 주세요.'); };
  async function read() {
    available();
    let encoded;
    try { encoded = await readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('저장한 연결 정보를 열지 못했어요. 웹에서 다시 연결해 주세요.'); }
    try {
      const envelope = JSON.parse(encoded);
      if (envelope.version !== 1 || typeof envelope.data !== 'string') throw new Error();
      const value = JSON.parse(protector.decrypt(Buffer.from(envelope.data, 'base64')));
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
      return value;
    } catch (error) {
      // Keep the original encrypted bytes; a new device must pass web pairing again.
      available();
      if (['EACCES', 'EPERM', 'ERR_ACCESS_DENIED', 'ERR_PERMISSION_DENIED'].includes(error.code) || /permission denied|access (?:is )?denied|operation not permitted|keychain.*(?:locked|denied)/i.test(error.message)) throw new Error('OS 보안 저장소에 접근할 수 없어요. 접근 권한을 확인한 뒤 다시 연결해 주세요.');
      try { await rename(file, `${file}.unreadable-${randomUUID()}.enc.bak`); }
      catch { throw new Error('저장한 연결 정보를 보존하지 못했어요. 앱에서 다시 연결해 주세요.'); }
      return {};
    }
  }
  function update(change) {
    return serialize(async () => {
      available(); const values = await read(); change(values);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      available();
      await writeFile(temporary, JSON.stringify({ version: 1, data: protector.encrypt(JSON.stringify(values)).toString('base64') }), { mode: 0o600 });
      await rename(temporary, file); await chmod(file, 0o600);
    });
  }
  return {
    load(applicationId) { return serialize(async () => {
      const values = await read(); const value = values[applicationId];
      if (!value) return null;
      if (!TOKEN_PATTERN.test(value.deviceToken ?? '') || (value.deviceId !== null && !ID_PATTERN.test(value.deviceId ?? '')) || !['windows', 'macos', 'linux'].includes(value.platform)) throw new Error('저장한 연결 정보를 확인하지 못했어요.');
      return value;
    }); },
    save(applicationId, value) { if (!ID_PATTERN.test(applicationId) || !TOKEN_PATTERN.test(value.deviceToken ?? '')) return Promise.reject(new Error('연결 정보를 확인해 주세요.')); return update(values => { values[applicationId] = value; }); },
    remove(applicationId) { return update(values => { delete values[applicationId]; }); },
  };
}
