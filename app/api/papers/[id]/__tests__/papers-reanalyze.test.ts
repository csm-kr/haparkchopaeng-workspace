// @vitest-environment node
// Existing team-boundary tests now require an explicit local selection (ADR-026).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError } from "@/lib/http";
const m = vi.hoisted(() => ({ session: vi.fn(), team: vi.fn(), request: vi.fn(), read: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getConnectionSession: m.session }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: m.team }));
vi.mock("@/lib/local-ai/service", () => ({ LocalAnalysisRequestSchema: z.object({ deviceId: z.string(), provider: z.enum(["codex", "claude"]), model: z.string().min(1), requestId: z.uuid() }).strict(), requestLocalAnalysis: m.request, getLocalAnalysisState: m.read, cancelLocalAnalysis: m.cancel }));
const { POST, GET, DELETE } = await import("../reanalyze/route");
const input = { deviceId: "pc", provider: "codex", model: "actual-model", requestId: "5764df42-253c-4279-88a8-dce34b107342" };
const req = (body: unknown = input, origin = "https://research.test") => new Request("https://research.test/api/papers/p1/reanalyze", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "p1" }) };
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ memberId: "ha", sessionKey: "session-fingerprint", expiresAt: new Date(Date.now() + 3600000) });
  m.team.mockResolvedValue({ id: "tA" });
  m.request.mockResolvedValue({ id: "p1", runId: "run", analysisStatus: "pending" });
  m.read.mockResolvedValue({ id: "p1", analysisStatus: "awaiting_ai" });
  m.cancel.mockResolvedValue({ id: "p1", analysisStatus: "awaiting_ai" });
});
describe("POST /api/papers/:id/reanalyze", () => {
  it("accepts an explicit selection and injects the verified team and session", async () => {
    expect((await POST(req(), ctx)).status).toBe(202);
    expect(m.request).toHaveBeenCalledWith(expect.objectContaining({ teamId: "tA", memberId: "ha", sessionKey: "session-fingerprint" }), "p1", input);
  });
  it("keeps another team's paper hidden", async () => {
    m.request.mockRejectedValue(new HttpError(404, "NOT_FOUND", "논문을 찾을 수 없어요."));
    expect((await POST(req(), ctx)).status).toBe(404);
  });
  it("rejects a missing active team before starting a job", async () => {
    m.team.mockResolvedValue(null);
    expect((await POST(req(), ctx)).status).toBe(403);
    expect(m.request).not.toHaveBeenCalled();
  });
  it("requires a selection and rejects owner/context injection", async () => {
    expect((await POST(req({}), ctx)).status).toBe(400);
    expect((await POST(req({ ...input, context: "fake", teamId: "other" }), ctx)).status).toBe(400);
    expect(m.request).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and signed-out execution", async () => {
    expect((await POST(req(input, "https://evil.test"), ctx)).status).toBe(403);
    m.session.mockResolvedValue(null);
    expect((await POST(req(), ctx)).status).toBe(401);
    expect(m.request).not.toHaveBeenCalled();
  });
  it("serves private status and authenticated cancellation", async () => {
    const result = await GET(new Request("https://research.test/api/papers/p1/reanalyze"), ctx);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect((await DELETE(new Request("https://research.test/api/papers/p1/reanalyze", { method: "DELETE", headers: { origin: "https://research.test" } }), ctx)).status).toBe(200);
    expect(m.cancel).toHaveBeenCalledWith(expect.objectContaining({ teamId: "tA" }), "p1");
  });
});
