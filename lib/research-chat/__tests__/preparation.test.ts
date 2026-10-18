// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ job: vi.fn(), knownJob: vi.fn(), update: vi.fn(), member: vi.fn(), papers: vi.fn(), presentations: vi.fn(), download: vi.fn(), extract: vi.fn(), preparePaper: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { localAgentJob: { findFirst: m.job, findUnique: m.knownJob, updateMany: m.update }, membership: { findUnique: m.member }, paper: { findMany: m.papers }, presentation: { findMany: m.presentations } } }));
vi.mock("@/lib/storage", () => ({ downloadObject: m.download }));
vi.mock("@/lib/local-ai/service", () => ({ preparePaperSource: m.preparePaper }));
vi.mock("@/lib/local-ai/source", async (original) => ({ ...await original<typeof import("@/lib/local-ai/source")>(), extractPdfSource: m.extract }));
import { prepareChatTurn } from "../preparation";

const context = JSON.stringify({ version: 1, kind: "research_chat", truncated: false, preparing: true, papers: [], presentations: [{ id: "seminar", title: "주간 세미나" }], history: [{ turn: 1, question: "앞선 질문", answer: "앞선 답변" }] });
beforeEach(() => {
  vi.clearAllMocks();
  m.job.mockResolvedValue({ id: "job", teamId: "team", memberId: "member", version: 0, context });
  m.knownJob.mockResolvedValue({ id: "job" });
  m.member.mockResolvedValue({ memberId: "member" });
  m.papers.mockResolvedValue([]);
  m.presentations.mockResolvedValue([{ id: "seminar", title: "주간 세미나", summary: null, keypoints: [], slides: [], assets: [{ id: "pdf", url: "presentations/private.pdf" }] }]);
  m.download.mockResolvedValue(Buffer.from("%PDF-fixture"));
  m.extract.mockResolvedValue({ text: JSON.stringify([{ page: 1, text: "세미나 PDF의 실제 본문" }]) });
  m.update.mockResolvedValue({ count: 1 });
});

describe("durable chat material preparation", () => {
  it("reads the team's seminar PDF off the request path and queues only extracted text and captured history", async () => {
    await prepareChatTurn("job");
    expect(m.download).toHaveBeenCalledWith("presentations/private.pdf");
    const write = m.update.mock.calls[0][0];
    expect(write.where).toMatchObject({ id: "job", teamId: "team", memberId: "member", status: "preparing", version: 0 });
    expect(write.where.grant).toMatchObject({ revokedAt: null });
    expect(write.data.status).toBe("queued");
    expect(write.data.context).toContain("세미나 PDF의 실제 본문");
    expect(write.data.context).toContain("앞선 답변");
    expect(write.data.context).not.toContain("private.pdf");
  });
  it("never revives a cancelled/expired turn or reads files after team permission ends", async () => {
    m.job.mockResolvedValueOnce(null);
    await prepareChatTurn("job");
    expect(m.download).not.toHaveBeenCalled();
    m.member.mockResolvedValue(null);
    await expect(prepareChatTurn("job")).rejects.toMatchObject({ status: 403 });
    expect(m.download).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
  it("retries an event delivered before admission commits", async () => {
    m.job.mockResolvedValue(null); m.knownJob.mockResolvedValue(null);
    await expect(prepareChatTurn("job")).rejects.toThrow("not committed");
    expect(m.download).not.toHaveBeenCalled();
  });
});
