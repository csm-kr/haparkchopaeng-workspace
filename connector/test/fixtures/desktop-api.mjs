// Explicitly started desktop UI fixture. Binds loopback only, never queues CLI inference.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const port = Number(process.env.CONNECTOR_QA_PORT ?? 3000);
let mode = 'ok'; const attempts = new Map(), devices = new Map();
const stats = { ack: 0, pair: 0, heartbeat: 0, claim: 0, strictRejected: 0, fingerprints: [] };
const lease = () => new Date(Date.now() + (mode === 'short_lease' ? 1500 : 45000)).toISOString();
function desktopAttempt(attemptId, identity, connected = false) { return { attemptId, version: 1, status: connected ? 'connected' : 'awaiting_code', expiresAt: new Date(Date.now() + 300000).toISOString(), siteName: '하박조팽', teamName: '연구 팀 · QA', memberName: '테스트 연구자', deviceId: connected ? 'qa-device-1' : null, leaseExpiresAt: connected ? lease() : null }; }
function respond(response, status, data, code) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(status < 400 ? { data } : { error: { code: code ?? (status === 429 ? 'TOO_MANY_ATTEMPTS' : status === 400 ? 'WRONG_CODE' : status === 410 ? 'PAIRING_EXPIRED' : 'UNAUTHORIZED'), message: '테스트 오류 본문은 앱에 그대로 반사하지 않아요.' } })); }
const server = createServer(async (request, response) => {
  let body = {}; try { const chunks = []; for await (const chunk of request) { chunks.push(chunk); if (Buffer.concat(chunks).length > 1000000) throw new Error(); } const text = Buffer.concat(chunks).toString(); if (text) body = JSON.parse(text); } catch { respond(response, 400); return; }
  if (request.url === '/_qa/stats') { respond(response, 200, stats); return; }
  if (request.url === '/_qa/control') { mode = body.mode ?? 'ok'; respond(response, 200, { mode }); return; }
  if (mode === 'unauthorized') { respond(response, 401); return; }
  if (mode === 'offline') { respond(response, 503); return; }
  if (request.url === '/api/local-agent/desktop/ack') {
    const expected = ['attemptId', 'launchToken', 'deviceToken', 'deviceName', 'platform'];
    if (Object.keys(body).length !== expected.length || !Object.keys(body).every(key => expected.includes(key))) { stats.strictRejected += 1; respond(response, 400); return; }
    stats.ack += 1; const fingerprint = createHash('sha256').update(body.deviceToken).digest('hex'); if (!stats.fingerprints.includes(fingerprint)) stats.fingerprints.push(fingerprint);
    attempts.set(body.attemptId, { ...body, tries: 0 }); respond(response, 200, desktopAttempt(body.attemptId, body, mode !== 'require_pairing' && devices.has(body.deviceToken))); return;
  }
  if (request.url === '/api/local-agent/desktop/pair') {
    stats.pair += 1; const attempt = attempts.get(body.attemptId);
    if (!attempt || attempt.launchToken !== body.launchToken || attempt.deviceToken !== body.deviceToken) { respond(response, 401); return; }
    if (attempt.tries >= 5) { respond(response, 410); return; }
    if (body.code !== '482107') { attempt.tries += 1; respond(response, attempt.tries >= 5 ? 410 : 400); return; }
    devices.set(body.deviceToken, 'qa-device-1'); respond(response, 200, desktopAttempt(body.attemptId, body, true)); return;
  }
  const token = request.headers.authorization?.replace(/^Bearer /, '');
  if (!devices.has(token) || request.headers['x-local-agent-device'] !== 'qa-device-1') { respond(response, 401); return; }
  if (request.url === '/api/local-agent/desktop/heartbeat') { stats.heartbeat += 1; respond(response, 200, { leaseExpiresAt: lease(), cancelJobIds: [], heartbeatIntervalSeconds: 5 }); return; }
  if (request.url === '/api/local-agent/desktop/claim') { stats.claim += 1; respond(response, 200, null); return; }
  respond(response, 404);
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ desktopFixture: true, port })));
