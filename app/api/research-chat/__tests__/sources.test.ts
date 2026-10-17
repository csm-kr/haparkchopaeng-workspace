// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), team: vi.fn(), papers: vi.fn(), update: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getConnectionSession: m.session }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: m.team }));
vi.mock("@/lib/prisma", () => ({ prisma: { paper: { findMany: m.papers, updateMany: m.update } } }));
vi.mock("@/lib/inngest", () => ({ inngest: { send: m.send } }));
const { POST } = await import("../sources/route");
const request = (body: unknown, origin = "https://research.test") => new Request("https://research.test/api/research-chat/sources", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue({ memberId: "ha", sessionKey: "session", expiresAt: new Date(Date.now() + 3600000) }); m.team.mockResolvedValue({ id: "team" }); m.papers.mockResolvedValue([{ id: "paper", sourceText: null }]); m.update.mockResolvedValue({ count: 1 }); m.send.mockResolvedValue({ ids: ["event"] }); });
describe("prepare old papers for research chat", () => {
  it("queues original text preparation without a model selection or an inference request", async () => {
    expect((await POST(request({ paperIds: ["paper"] }))).status).toBe(202);
    expect(m.papers).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["paper"] }, teamId: "team" } }));
    expect(m.send).toHaveBeenCalledWith([{ name: "paper/analyze", data: { paperId: "paper" } }]);
  });
  it("avoids repeating preparation and rejects another team's paper", async () => {
    m.papers.mockResolvedValue([{ id: "paper", sourceText: "prepared original" }]);
    expect((await POST(request({ paperIds: ["paper"] }))).status).toBe(202);
    expect(m.send).not.toHaveBeenCalled();
    m.papers.mockResolvedValue([]);
    expect((await POST(request({ paperIds: ["foreign"] }))).status).toBe(404);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
  it("clears only owned source errors before retry, preserving other failures and prepared results", async () => {
    m.papers.mockResolvedValue([{ id: "paper", sourceText: null }, { id: "prepared", sourceText: "original" }]);
    expect((await POST(request({ paperIds: ["paper", "prepared"] }))).status).toBe(202);
    expect(m.update).toHaveBeenCalledWith({
      where: { id: { in: ["paper"] }, teamId: "team", sourceText: null, analysisError: { in: expect.arrayContaining(["PDF는 1~30쪽까지 분석할 수 있어요."]) } },
      data: { analysisError: null },
    });
    const allowedErrors = m.update.mock.calls[0][0].where.analysisError.in;
    expect(allowedErrors).not.toContain("모델 응답 형식을 확인하지 못했어요.");
    expect(m.update.mock.invocationCallOrder[0]).toBeLessThan(m.send.mock.invocationCallOrder[0]);
    expect(m.send).toHaveBeenCalledWith([{ name: "paper/analyze", data: { paperId: "paper" } }]);
  });
  it("rejects unbounded sources, caller context, and cross-origin requests", async () => {
    expect((await POST(request({ paperIds: ["a", "b", "c", "d"] }))).status).toBe(400);
    expect((await POST(request({ paperIds: ["a"], context: "fake" }))).status).toBe(400);
    expect((await POST(request({ paperIds: ["a"] }, "https://evil.test"))).status).toBe(403);
    expect(m.papers).not.toHaveBeenCalled();
  });
});
