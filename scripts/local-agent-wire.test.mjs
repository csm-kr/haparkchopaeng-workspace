import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApiClient } from "../connector/core/api.mjs";
import { createDeviceIdentity, parseLaunchUrl } from "../connector/core/security.mjs";
import { desktopAckInput, desktopPairInput } from "../connector/core/protocol.mjs";
import { ConnectorSession } from "../connector/core/runtime.mjs";

const enabled = process.env.HAPARK_ISOLATED_TESTS === "1" && process.env.DATABASE_URL?.startsWith("file:");

test("real HTTP server and desktop runtime: pairing, research result, cancellation, logout and cookie-loss expiry", { skip: !enabled, timeout: 240_000 }, async () => {
  const origin = process.env.LOCAL_AGENT_E2E_URL;
  assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const cookies = new Map();
  async function web(path, method = "GET", body, expected = 200, originHeader = origin) {
    const res = await fetch(`${origin}${path}`, { method, headers: {
      Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
      Origin: originHeader, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";"); const separator = pair.indexOf("=");
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    assert.equal(res.status, expected, `HTTP ${method} ${path} status`);
    return (await res.json()).data;
  }
  const signIn = () => web("/api/auth/login", "POST", { email: "de8167@gmail.com" });
  await signIn();
  await web("/api/local-agent/attempts", "POST", {}, 403, "https://other.example");
  const identity = createDeviceIdentity("win32");
  identity.deviceName = "격리 HTTP 검증 PC";
  const api = createApiClient({ origin, allowedOrigins: [origin], development: true, timeoutMs: 30_000 });
  const applications = [{ id: "hapark", scheme: "hapark-connect", origin }];
  async function pair(checkWrongCode = false) {
    const created = await web("/api/local-agent/attempts", "POST", {}, 201);
    assert.match(created.code, /^\d{6}$/);
    assert.equal(new URL(created.deepLink).searchParams.has("code"), false);
    const launch = parseLaunchUrl(created.deepLink, applications);
    const acknowledged = await api.post("ack", desktopAckInput(launch, identity));
    assert.equal(acknowledged.status, "awaiting_code");
    assert.equal(Object.hasOwn(acknowledged, "code"), false);
    if (checkWrongCode) await assert.rejects(api.post("pair", desktopPairInput(launch, identity, created.code === "000000" ? "111111" : "000000")), { status: 400 });
    const paired = await api.post("pair", desktopPairInput(launch, identity, created.code));
    identity.deviceId = paired.deviceId;
    assert.ok(identity.deviceId);
    const status = await web(`/api/local-agent/status?deviceId=${identity.deviceId}`);
    assert.equal(status.device.id, identity.deviceId);
    return paired;
  }
  let paired = await pair(true);
  const provider = () => ({ provider: "codex", status: "ready", models: [{ id: "wire-fixture-model", name: "HTTP fixture model" }],
    quota: { short: null, weekly: { label: "7일 한도", remainingPercent: 44, resetsAt: null } }, observedAt: new Date().toISOString() });
  await api.post("heartbeat", { providers: [provider()] }, identity);
  await web("/api/local-agent/jobs", "POST", { deviceId: identity.deviceId, paperId: "local-agent-paper", provider: "codex", model: "unadvertised-model", prompt: "2+2?", requestId: randomUUID() }, 409);
  async function enqueue(prompt) {
    await web("/api/local-agent/web-heartbeat", "POST", { deviceId: identity.deviceId });
    return web("/api/local-agent/jobs", "POST", { deviceId: identity.deviceId, paperId: "local-agent-paper", provider: "codex", model: "wire-fixture-model", prompt, requestId: randomUUID() }, 202);
  }
  const adapter = { run: async ({ prompt, context, onText, signal }) => {
    assert.match(context, /격리 검증용 논문/);
    if (prompt === "WAIT_FOR_CANCEL") await new Promise((accept) => {
      if (signal.aborted) accept(); else signal.addEventListener("abort", accept, { once: true });
    });
    onText("4"); // Fake model, real server/queue/desktop transport. No paid CLI call.
  } };
  const runtime = new ConnectorSession({ api, identity, adapters: { codex: adapter }, setIntervalFn: () => null, clearIntervalFn: () => {} });
  runtime.setProviders([provider()]); runtime.start(paired.leaseExpiresAt);
  try {
    const question = await enqueue("2+2?");
    await runtime.tick(); await runtime.whenIdle();
    const result = await web(`/api/local-agent/jobs/${question.id}`);
    assert.equal(result.status, "completed"); assert.equal(result.response, "4");
    runtime.lastClaim = -Infinity;
    const cancellable = await enqueue("WAIT_FOR_CANCEL");
    await runtime.tick();
    await web(`/api/local-agent/jobs/${cancellable.id}/cancel`, "POST", {});
    runtime.lastHeartbeat = -Infinity;
    await runtime.tick(); await runtime.whenIdle();
    assert.equal((await web(`/api/local-agent/jobs/${cancellable.id}`)).status, "cancelled");
    await web("/api/auth/logout", "POST", {});
    await assert.rejects(api.post("heartbeat", { providers: [provider()] }, identity), { status: 403 });
  } finally { runtime.stop(); }

  // Same installed identity, new signed-in session: code is required again.
  await signIn(); paired = await pair();
  const expires = Date.parse((await web(`/api/local-agent/status?deviceId=${identity.deviceId}`)).device.leaseExpiresAt);
  const heartbeat = await api.post("heartbeat", { providers: [provider()] }, identity);
  // The web grant lasts two minutes, but the app only ever sees 45 seconds ahead.
  assert.ok(Date.parse(heartbeat.leaseExpiresAt) <= Date.now() + 45_000);
  cookies.clear(); // No logout request reaches the server.
  const expiring = new ConnectorSession({ api, identity, adapters: { codex: adapter } });
  expiring.setProviders([provider()]); expiring.start(heartbeat.leaseExpiresAt);
  try {
    await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error("Cookie-loss permission outlived its two-minute web grant")), expires - Date.now() + 5_000);
      const observe = (state) => {
        if (["authorization_required", "recovering"].includes(state.status)) { clearTimeout(timer); expiring.off("state", observe); accept(); }
      };
      expiring.on("state", observe);
    });
    assert.ok(Date.now() >= expires);
    assert.ok(Date.now() - expires < 2500);
    await assert.rejects(api.post("claim", {}, identity), { status: 403 });
  } finally { expiring.stop(); }
});
