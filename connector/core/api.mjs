import { normalizeOrigin, TOKEN_PATTERN, ID_PATTERN } from './security.mjs';

const ACTIONS = new Set(['ack', 'pair', 'heartbeat', 'claim', 'result']);
const CODE_MESSAGES = {
  WRONG_CODE: '번호가 맞지 않아요. 웹의 6자리를 다시 확인해 주세요.',
  PAIRING_EXPIRED: '입력 횟수를 다 썼거나 번호가 만료됐어요. 웹에서 새 번호를 받아 주세요.',
  PAIRING_USED: '이미 확인한 번호예요. 웹에서 연결 상태를 확인해 주세요.',
  ANOTHER_CONNECTOR: '다른 연결기가 이 요청을 확인했어요. 웹에서 다시 연결해 주세요.',
  DEVICE_UNAUTHORIZED: '웹에서 이 PC를 다시 연결해 주세요.',
  WEB_PERMISSION_EXPIRED: '웹 연결 권한이 끝났어요. 웹에서 AI 연결을 다시 눌러 주세요.',
};
export class ConnectorApiError extends Error {
  constructor(status, code = 'CONNECTION_ERROR') {
    super(CODE_MESSAGES[code] ?? ({ 400: '요청을 확인해 주세요.', 401: '웹에서 다시 연결해 주세요.', 403: '연결 권한이 종료됐어요.', 404: '연결 요청을 찾을 수 없어요.', 409: '연결 상태가 바뀌었어요. 웹에서 다시 시도해 주세요.', 410: '연결 요청이 만료됐어요.', 429: '잠시 후 다시 시도해 주세요.' })[status] ?? '웹앱에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
    this.name = 'ConnectorApiError'; this.status = status; this.code = code;
  }
}

export function createApiClient({ origin, allowedOrigins, development = false, fetchImpl = fetch, timeoutMs = 10000 }) {
  const base = normalizeOrigin(origin, { development });
  if (!allowedOrigins.some(value => normalizeOrigin(value, { development }) === base)) throw new Error('등록되지 않은 웹앱에는 연결할 수 없어요.');
  return {
    async post(action, body, identity, signal) {
      if (!ACTIONS.has(action)) throw new Error('허용되지 않은 연결 요청이에요.');
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (identity) {
        if (!TOKEN_PATTERN.test(identity.deviceToken) || !ID_PATTERN.test(identity.deviceId ?? '')) throw new ConnectorApiError(401);
        headers.Authorization = `Bearer ${identity.deviceToken}`;
        headers['X-Local-Agent-Device'] = identity.deviceId;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetchImpl(`${base}/api/local-agent/desktop/${action}`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
        if (!response.ok) {
          let code;
          try { const data = await response.json(); if (/^[A-Z_]{1,80}$/.test(data?.error?.code ?? '')) code = data.error.code; } catch {}
          throw new ConnectorApiError(response.status, code);
        }
        const envelope = await response.json();
        if (!envelope || !Object.hasOwn(envelope, 'data')) throw new ConnectorApiError(502);
        return envelope.data;
      } catch (error) {
        if (error instanceof ConnectorApiError) throw error;
        if (signal?.aborted) throw Object.assign(new Error('연결 요청을 취소했어요.'), { name: 'AbortError' });
        throw new ConnectorApiError(0);
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
    },
  };
}
