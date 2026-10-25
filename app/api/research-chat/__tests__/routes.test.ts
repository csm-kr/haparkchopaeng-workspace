// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), team: vi.fn(), list: vi.fn(), create: vi.fn(), detail: vi.fn(), turn: vi.fn(), cancel: vi.fn(), remove: vi.fn(), papers: vi.fn(), presentations: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getConnectionSession: mocks.session }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: mocks.team }));
vi.mock("@/lib/research-chat/service", () => ({ listConversations: mocks.list, createConversation: mocks.create, getConversation: mocks.detail, createTurn: mocks.turn, cancelTurn: mocks.cancel, deleteConversation: mocks.remove, listResearchPapers: mocks.papers, listResearchPresentations: mocks.presentations }));
const { GET: list, POST: create } = await import("../conversations/route");
const { GET: detail, DELETE: remove } = await import("../conversations/[id]/route");
const { POST: turn } = await import("../conversations/[id]/turns/route");
const { POST: cancel } = await import("../conversations/[id]/turns/[jobId]/cancel/route");
const { GET: papers } = await import("../papers/route");
const { GET: presentations } = await import("../presentations/route");
const origin = "https://research.test";
const request = (body: unknown, from = origin) => new Request(origin + "/api/research-chat/conversations", { method: "POST", headers: { origin: from, "content-type": "application/json" }, body: JSON.stringify(body) });
const requestId = "cba0088a-824a-4d00-8e4b-8a1b80f51624";
const params = () => ({ params: Promise.resolve({ id: "conversation" }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ memberId: "server-owner", sessionKey: "server-session", expiresAt: new Date(Date.now() + 100_000) });
  mocks.team.mockResolvedValue({ id: "server-team" });
  mocks.list.mockResolvedValue([]);
  mocks.papers.mockResolvedValue([]);
  mocks.presentations.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "conversation" });
  mocks.detail.mockResolvedValue({ conversation: { id: "conversation" }, turns: [] });
  mocks.turn.mockResolvedValue({ id: "job", status: "queued" });
  mocks.cancel.mockResolvedValue({ id: "job", status: "cancelled" });
  mocks.remove.mockResolvedValue({ deleted: true });
});

describe("research chat API boundaries", () => {
  it("requires authentication for history and paper discovery without touching data", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await list(new Request(origin + "/api/research-chat/conversations"))).status).toBe(401);
    expect((await papers(new Request(origin + "/api/research-chat/papers"))).status).toBe(401);
    expect((await presentations(new Request(origin + "/api/research-chat/presentations"))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.papers).not.toHaveBeenCalled();
    expect(mocks.presentations).not.toHaveBeenCalled();
  });
  it("injects owner/team from server and applies private cache headers", async () => {
    const response = await create(request({ requestId, title: "실험 비교", paperIds: ["paper-a", "paper-b"] }));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ memberId: "server-owner", teamId: "server-team", sessionKey: "server-session" }), { requestId, title: "실험 비교", paperIds: ["paper-a", "paper-b"] });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).data.id).toBe("conversation");
  });
  it("rejects foreign origins and caller-supplied authority/context before creating work", async () => {
    expect((await create(request({ requestId, paperIds: ["paper-a"] }, "https://evil.test"))).status).toBe(403);
    for (const injection of [{ teamId: "foreign" }, { memberId: "foreign" }, { context: "forged source" }, { purpose: "paper_analysis" }]) {
      expect((await create(request({ requestId, paperIds: ["paper-a"], ...injection }))).status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("allows free chat and accepts only bounded unique references and explicit model turns", async () => {
    expect((await create(request({ requestId, paperIds: [] }))).status).toBe(201);
    expect((await create(request({ requestId }))).status).toBe(201);
    for (const paperIds of [["a", "a"], Array.from({ length: 11 }, (_, n) => `paper-${n}`)]) expect((await create(request({ requestId, paperIds }))).status).toBe(400);
    const input = { requestId, deviceId: "device", provider: "codex", model: "actual-model", prompt: "실험을 비교해줘" };
    expect((await turn(request(input), params())).status).toBe(202);
    expect(mocks.turn).toHaveBeenCalledWith(expect.objectContaining({ teamId: "server-team" }), "conversation", input);
    expect((await turn(request({ ...input, context: "forged" }), params())).status).toBe(400);
    expect((await turn(request({ ...input, prompt: "x".repeat(12_001) }), params())).status).toBe(400);
    expect((await turn(request({ ...input, provider: "gemini" }), params())).status).toBe(400);
    expect((await turn(request({ ...input, effort: "high; run-shell" }), params())).status).toBe(400);
    expect((await turn(request({ ...input, effort: "high", presentationIds: ["seminar"] }), params())).status).toBe(202);
  });
  it("routes history and cancellation to the owned conversation with a strict empty cancel body", async () => {
    expect((await detail(new Request(origin + "/api/research-chat/conversations/conversation"), params())).status).toBe(200);
    expect(mocks.detail).toHaveBeenCalledWith(expect.objectContaining({ memberId: "server-owner" }), "conversation");
    const context = { params: Promise.resolve({ id: "conversation", jobId: "job" }) };
    expect((await cancel(request({}), context)).status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({ sessionKey: "server-session" }), "conversation", "job");
    expect((await cancel(request({ jobId: "other" }), context)).status).toBe(400);
  });
  it("deletes only through the server scope from the same web origin", async () => {
    const deletion = (from = origin) => new Request(origin + "/api/research-chat/conversations/conversation", { method: "DELETE", headers: { origin: from } });
    expect((await remove(deletion("https://evil.test"), params())).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
    const response = await remove(deletion(), params());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ deleted: true });
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ memberId: "server-owner", teamId: "server-team" }), "conversation");
  });
});
