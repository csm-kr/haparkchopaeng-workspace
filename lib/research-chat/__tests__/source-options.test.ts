// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), papers: vi.fn(), conversation: vi.fn(), expire: vi.fn(), turns: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  membership: { findUnique: m.member }, paper: { findMany: m.papers },
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
  m.conversation.mockResolvedValue({ id: "conversation", title: "Question", paperIds: rows.map(row => row.id), createdAt: new Date(), updatedAt: new Date() });
  m.expire.mockResolvedValue({ count: 0 }); m.turns.mockResolvedValue([]);
});
describe("research source readiness", () => {
  it.each(["list", "detail"])("returns only owned source failure reasons in %s", async (view) => {
    const result = view === "list" ? await listResearchPapers(scope) : (await getConversation(scope, "conversation")).papers;
    expect(result).toEqual([
      { id: "failed", title: "Failed", sourceReady: false, sourceError: reason },
      { id: "private", title: "Private", sourceReady: false, sourceError: null },
      { id: "ready", title: "Ready", sourceReady: true, sourceError: null },
    ]);
  });
});
