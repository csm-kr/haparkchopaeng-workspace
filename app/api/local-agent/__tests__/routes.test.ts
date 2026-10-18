// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), team: vi.fn(), status: vi.fn(), create: vi.fn(), ack: vi.fn(), result: vi.fn(), heartbeat: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getConnectionSession: mocks.session }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: mocks.team }));
vi.mock("@/lib/local-agent/service", () => ({ getStatus: mocks.status, createAttempt: mocks.create, acknowledgeDesktop: mocks.ack, submitResult: mocks.result, desktopHeartbeat: mocks.heartbeat }));
const { GET: status } = await import("../status/route");
const { POST: create } = await import("../attempts/route");
const { POST: ack } = await import("../desktop/ack/route");
const { POST: result } = await import("../desktop/result/route");
const { POST: heartbeat } = await import("../desktop/heartbeat/route");
const webRequest = (body: unknown, origin = "https://research.test") => new Request("https://research.test/api/local-agent/attempts", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const deviceToken = Buffer.alloc(32, 6).toString("base64url");
const heartbeatRequest = (body: unknown, authenticated = true) => new Request("https://research.test/api/local-agent/desktop/heartbeat", { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${deviceToken}`, "x-local-agent-device": "device" } : {}) }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ memberId: "ha", role: "멤버", sessionKey: "server-session-fingerprint", expiresAt: new Date(Date.now() + 100_000) });
  mocks.team.mockResolvedValue({ id: "team-a", slug: "alpha", role: "member" });
  mocks.status.mockResolvedValue({ devices: [], device: null, leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 });
  mocks.create.mockResolvedValue({ id: "attempt", version: 0, status: "awaiting_app" });
  mocks.heartbeat.mockResolvedValue({ leaseExpiresAt: "2026-10-18T12:00:45.000Z", cancelJobIds: [], heartbeatIntervalSeconds: 5 });
});

describe("local agent API authentication", () => {
  it("forwards optional actual bridge metadata without changing the old desktop heartbeat", async () => {
    const metadata = { bridgeVersion: "0.1.5", bridgeArchitecture: "arm64" };
    const response = await heartbeat(heartbeatRequest({ providers: [], ...metadata }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.heartbeat).toHaveBeenLastCalledWith({ deviceId: "device", deviceToken }, [], metadata);
    expect((await heartbeat(heartbeatRequest({ providers: [] }))).status).toBe(200);
    expect(mocks.heartbeat).toHaveBeenLastCalledWith({ deviceId: "device", deviceToken }, [], {});
  });
  it("rejects invalid or unauthenticated bridge metadata before calling storage", async () => {
    expect((await heartbeat(heartbeatRequest({ providers: [], bridgeVersion: null }))).status).toBe(400);
    expect((await heartbeat(heartbeatRequest({ providers: [], bridgeArchitecture: "ia32" }))).status).toBe(400);
    expect((await heartbeat(heartbeatRequest({ providers: [], bridgeVersion: "0.1.5" }, false))).status).toBe(401);
    expect(mocks.heartbeat).not.toHaveBeenCalled();
  });
  it("does not expose status or touch storage without a session", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await status(new Request("https://research.test/api/local-agent/status"));
    expect(response.status).toBe(401);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("injects scope from verified server auth and leaves the current PC unselected without a hint", async () => {
    const response = await status(new Request("https://research.test/api/local-agent/status"));
    expect(response.status).toBe(200);
    expect(mocks.status).toHaveBeenCalledWith(expect.objectContaining({ memberId: "ha", teamId: "team-a", sessionKey: "server-session-fingerprint" }), undefined);
    expect((await response.json()).data.device).toBeNull();
  });
  it("blocks cross-origin pairing creation before touching storage", async () => {
    const response = await create(webRequest({}, "https://evil.test"));
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects owner/team injection and accepts the simple same-origin connect button", async () => {
    expect((await create(webRequest({ memberId: "other", teamId: "other" }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    const response = await create(webRequest({}));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ memberId: "ha", teamId: "team-a" }));
  });
  it("does not let a six-digit code replace the launch or device credentials", async () => {
    const response = await ack(webRequest({ attemptId: "a", launchToken: "482107", deviceToken: "482107", deviceName: "PC", platform: "windows" }));
    expect(response.status).toBe(400);
    expect(mocks.ack).not.toHaveBeenCalled();
  });
  it("rejects result writes without desktop credentials even with a valid web session", async () => {
    const response = await result(webRequest({}));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "DEVICE_UNAUTHORIZED", message: "AI 브릿지 승인이 필요해요." } });
    expect(mocks.result).not.toHaveBeenCalled();
  });
});
