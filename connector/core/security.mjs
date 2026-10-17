import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/;

export function normalizeOrigin(value, { development = false } = {}) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(development && loopback && url.protocol === 'http:'))) {
    throw new Error('등록된 HTTPS 웹앱 주소가 필요해요.');
  }
  return url.origin;
}

export function parseLaunchUrl(value, applications) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('연결 링크가 올바르지 않아요.');
  const url = new URL(value);
  const application = applications.find(app => `${app.scheme}:` === url.protocol);
  if (!application || url.hostname !== 'connect' || url.pathname || url.username || url.password || url.port || url.hash) throw new Error('등록된 앱의 연결 링크를 사용해 주세요.');
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.every(key => ['attemptId', 'launchToken'].includes(key))) throw new Error('연결 링크에 허용되지 않은 정보가 있어요.');
  const attemptId = url.searchParams.get('attemptId');
  const launchToken = url.searchParams.get('launchToken');
  if (!ID_PATTERN.test(attemptId ?? '') || !TOKEN_PATTERN.test(launchToken ?? '')) throw new Error('연결 링크가 만료되었거나 올바르지 않아요.');
  return { application, attemptId, launchToken };
}

export function createDeviceIdentity(platform = process.platform) {
  return {
    deviceToken: randomBytes(32).toString('base64url'),
    deviceId: null,
    deviceName: hostname().replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 80) || '내 PC',
    platform: ({ win32: 'windows', darwin: 'macos', linux: 'linux' })[platform] ?? platform,
  };
}

export function providerEnvironment(environment = process.env) {
  const env = { ...environment };
  for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDECODE']) delete env[key];
  return env;
}

export function validModel(value) {
  if (typeof value !== 'string' || !MODEL_PATTERN.test(value)) throw new Error('사용 가능한 모델을 선택해 주세요.');
  return value;
}
