// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), papers: vi.fn(), presentations: vi.fn(), conversation: vi.fn(), expire: vi.fn(), turns: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  membership: { findUnique: m.member }, paper: { findMany: m.papers }, presentation: { findMany: m.presentations },
  researchConversation: { findFirst: m.conversation }, localAgentJob: { updateMany: m.expire, findMany: m.turns },
} }));
vi.mock("@/lib/local-agent/service", () => ({ cancelJob: vi.fn(), createPreparedJob: vi.fn() }));
const { listResearchPapers, getConversation } = await import("../service");
const scope = { teamId: "team", memberId: "member", sessionKey: "session", sessionExpiresAt: new Date(Date.now() + 3_600_000) };
const reason = "PDF는 1~30쪽까지 분석할 수 있어요.";
const rows = [
  { id: "failed", title: "Failed", sourceText: null, analysisError: reason },
  { id: "private", title: "Private", sourceText: null, analysisError: "private filesystem path and provider error" },
  { id: "ready", title: "Ready", sourceText: "original text", analysisError: reason },
];
beforeEach(() => {
  vi.clearAllMocks(); m.member.mockResolvedValue({ memberId: "member" }); m.papers.mockResolvedValue(rows);
  m.presentations.mockResolvedValue([]);
  m.conversation.mockResolvedValue({ id: "conversation", title: "Question", paperIds: rows.map(row => row.id), createdAt: new Date(), updatedAt: new Date() });
  m.expire.mockResolvedValue({ count: 0 }); m.turns.mockResolvedValue([]);
});
describe("research source readiness", () => {
  it("keeps owned history readable after attached materials disappear without exposing unavailable references", async () => {
    const createdAt = new Date();
    const visiblePresentation = { id: "visible-seminar", title: "현재 팀 세미나", date: createdAt };
    m.conversation.mockResolvedValue({ id: "conversation", title: "Question", paperIds: {
      version: 2, paperIds: ["deleted-paper", "foreign-paper", "ready"],
      presentationIds: ["deleted-seminar", "foreign-seminar", "visible-seminar"],
    }, createdAt, updatedAt: createdAt });
    m.papers.mockResolvedValue([rows[2]]);
    m.presentations.mockResolvedValue([visiblePresentation]);
    m.turns.mockResolvedValue([{
      id: "past-turn", version: 1, paperId: "deleted-paper", provider: "codex", model: "actual",
      prompt: "이전 질문", status: "completed", response: "보존된 답변", error: null,
      createdAt, updatedAt: createdAt, conversationId: "conversation", conversationTurn: 1, sessionKey: scope.sessionKey,
      context: JSON.stringify({ version: 1, kind: "research_chat", papers: [{ id: "deleted-paper", title: "당시 논문" }], presentations: [{ id: "deleted-seminar", title: "당시 세미나" }] }),
    }]);
    const detail = await getConversation(scope, "conversation");
    expect(detail.conversation.paperIds).toEqual(["ready"]);
    expect(detail.conversation.presentationIds).toEqual(["visible-seminar"]);
    expect(detail.papers.map(paper => paper.id)).toEqual(["ready"]);
    expect(detail.presentations?.map(item => item.id)).toEqual(["visible-seminar"]);
    expect(detail.turns[0]).toMatchObject({ response: "보존된 답변", materials: [
      { id: "deleted-paper", title: "당시 논문", kind: "paper" },
      { id: "deleted-seminar", title: "당시 세미나", kind: "presentation" },
    ] });
    expect(m.conversation).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "conversation", teamId: scope.teamId, memberId: scope.memberId } }));
    expect(m.papers).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ teamId: scope.teamId }) }));
    expect(m.presentations).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ teamId: scope.teamId }) }));
  });

  it.each(["list", "detail"])("returns only owned source failure reasons in %s", async (view) => {
    const result = view === "list" ? await listResearchPapers(scope) : (await getConversation(scope, "conversation")).papers;
    expect(result).toEqual([
      { id: "failed", title: "Failed", sourceReady: false, sourceError: reason },
      { id: "private", title: "Private", sourceReady: false, sourceError: null },
      { id: "ready", title: "Ready", sourceReady: true, sourceError: null },
    ]);
  });
});
