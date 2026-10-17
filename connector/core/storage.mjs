import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TOKEN_PATTERN, ID_PATTERN } from './security.mjs';

export function createCredentialStore(file, protector) {
  let writeChain = Promise.resolve();
  const available = () => { if (!protector.available()) throw new Error('OS 보안 저장소를 사용할 수 없어요. 키체인 또는 보안 저장소를 켠 뒤 다시 연결해 주세요.'); };
  async function read() {
    available();
    try {
      const envelope = JSON.parse(await readFile(file, 'utf8'));
      if (envelope.version !== 1 || typeof envelope.data !== 'string') throw new Error();
      const value = JSON.parse(protector.decrypt(Buffer.from(envelope.data, 'base64')));
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
      return value;
    } catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('저장한 연결 정보를 열지 못했어요. 웹에서 다시 연결해 주세요.'); }
  }
  function update(change) {
    const next = writeChain.catch(() => {}).then(async () => {
      available(); const values = await read(); change(values);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, data: protector.encrypt(JSON.stringify(values)).toString('base64') }), { mode: 0o600 });
      await rename(temporary, file); await chmod(file, 0o600).catch(() => {});
    });
    writeChain = next; return next;
  }
  return {
    async load(applicationId) {
      const values = await read(); const value = values[applicationId];
      if (!value) return null;
      if (!TOKEN_PATTERN.test(value.deviceToken ?? '') || (value.deviceId !== null && !ID_PATTERN.test(value.deviceId ?? '')) || !['windows', 'macos', 'linux'].includes(value.platform)) throw new Error('저장한 연결 정보를 확인하지 못했어요.');
      return value;
    },
    save(applicationId, value) { if (!ID_PATTERN.test(applicationId) || !TOKEN_PATTERN.test(value.deviceToken ?? '')) return Promise.reject(new Error('연결 정보를 확인해 주세요.')); return update(values => { values[applicationId] = value; }); },
    remove(applicationId) { return update(values => { delete values[applicationId]; }); },
  };
}
