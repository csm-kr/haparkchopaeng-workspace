// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), team: vi.fn(), status: vi.fn(), create: vi.fn(), ack: vi.fn(), result: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getConnectionSession: mocks.session }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: mocks.team }));
vi.mock("@/lib/local-agent/service", () => ({ getStatus: mocks.status, createAttempt: mocks.create, acknowledgeDesktop: mocks.ack, submitResult: mocks.result }));
const { GET: status } = await import("../status/route");
const { POST: create } = await import("../attempts/route");
const { POST: ack } = await import("../desktop/ack/route");
const { POST: result } = await import("../desktop/result/route");
const webRequest = (body: unknown, origin = "https://research.test") => new Request("https://research.test/api/local-agent/attempts", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ memberId: "ha", role: "멤버", sessionKey: "server-session-fingerprint", expiresAt: new Date(Date.now() + 100_000) });
  mocks.team.mockResolvedValue({ id: "team-a", slug: "alpha", role: "member" });
  mocks.status.mockResolvedValue({ devices: [], device: null, leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 });
  mocks.create.mockResolvedValue({ id: "attempt", version: 0, status: "awaiting_app" });
});

describe("local agent API authentication", () => {
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
    expect(mocks.result).not.toHaveBeenCalled();
  });
});
