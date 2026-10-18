// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ job: vi.fn(), knownJob: vi.fn(), update: vi.fn(), member: vi.fn(), papers: vi.fn(), presentations: vi.fn(), verify: vi.fn(), transaction: vi.fn(), lockPaper: vi.fn(), lockPresentation: vi.fn(), lockAsset: vi.fn(), raw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { localAgentJob: { findFirst: m.job, findUnique: m.knownJob, updateMany: m.update }, membership: { findUnique: m.member }, paper: { findMany: m.papers }, presentation: { findMany: m.presentations }, $transaction: m.transaction } }));
vi.mock("@/worker/prepare-pdf-source", () => ({ verifyPreparedPdfSource: m.verify }));
import { assertChatPreparation, beginChatPreparation, finishChatPreparation } from "../preparation";
import { PaperSourceError } from "@/lib/local-ai/source";

const context = JSON.stringify({ version: 1, kind: "research_chat", truncated: false, preparing: true, papers: [], presentations: [{ id: "seminar", title: "주간 세미나" }], history: [{ turn: 1, question: "앞선 질문", answer: "앞선 답변" }] });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LOCAL_AGENT_TEST_CLIENT_MODULE", ""); vi.stubEnv("LOCAL_AGENT_PG_TEST_CLIENT_MODULE", "");
  vi.stubEnv("HAPARK_ISOLATED_TESTS", ""); vi.stubEnv("HAPARK_PG_ISOLATED_TESTS", "");
  vi.stubEnv("DATABASE_URL", "postgresql://blocked:blocked@127.0.0.1:1/unit_no_database");
  m.job.mockResolvedValue({ id: "job", teamId: "team", memberId: "member", version: 0, context });
  m.knownJob.mockResolvedValue({ id: "job" });
  m.member.mockResolvedValue({ memberId: "member" });
  m.papers.mockResolvedValue([]);
  m.presentations.mockResolvedValue([{ id: "seminar", title: "주간 세미나", summary: null, keypoints: [], slides: [], assets: [{ id: "pdf", url: "presentations/private.pdf" }] }]);
  m.verify.mockResolvedValue(undefined);
  m.update.mockResolvedValue({ count: 1 });
  m.lockPaper.mockResolvedValue({ count: 1 }); m.lockPresentation.mockResolvedValue({ count: 1 }); m.lockAsset.mockResolvedValue({ count: 1 });
  m.raw.mockImplementation(async (_query, id) => [{ id }]);
  m.transaction.mockImplementation(async action => action({ $queryRaw: m.raw, localAgentJob: { updateMany: m.update }, paper: { findMany: m.papers, updateMany: m.lockPaper }, presentation: { findMany: m.presentations, updateMany: m.lockPresentation }, presentationAsset: { updateMany: m.lockAsset } }));
});
afterEach(() => { vi.unstubAllEnvs(); });
const seminarSource = () => ({ target: { kind: "presentation" as const, id: "seminar", teamId: "team" }, objectKey: "presentations/private.pdf", assetId: "pdf", source: { text: JSON.stringify([{ page: 1, text: "Verified seminar body" }]), digest: "a".repeat(64), pageCount: 1 } });

describe("durable chat material preparation", () => {
  it("reads the team's seminar PDF off the request path and queues only extracted text and captured history", async () => {
    const plan = await beginChatPreparation("job");
    expect(m.update).not.toHaveBeenCalled();
    const prepared = { target: { kind: "presentation" as const, id: "seminar", teamId: "team" }, objectKey: "presentations/private.pdf", assetId: "pdf", source: { text: JSON.stringify([{ page: 1, text: "세미나 PDF의 실제 본문", method: "ocr" }]), digest: "a".repeat(64), pageCount: 1 } };
    await finishChatPreparation(plan!, [prepared]);
    expect(m.verify).toHaveBeenCalledWith(prepared);
    const write = m.update.mock.calls[0][0];
    expect(write.where).toMatchObject({ id: "job", teamId: "team", memberId: "member", status: "preparing", version: 0 });
    expect(write.where.grant).toMatchObject({ revokedAt: null });
    expect(write.data.status).toBe("queued");
    expect(write.data.context).toContain("세미나 PDF의 실제 본문");
    expect(write.data.context).toContain("앞선 답변");
    expect(write.data.context).toContain('"method":"ocr"');
    expect(write.data.context).not.toContain("private.pdf");
  });
  it("never revives a cancelled/expired turn or reads files after team permission ends", async () => {
    m.job.mockResolvedValueOnce(null);
    expect(await beginChatPreparation("job")).toBeNull();
    m.member.mockResolvedValue(null);
    await expect(beginChatPreparation("job")).rejects.toMatchObject({ status: 403 });
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
  it("retries an event delivered before admission commits", async () => {
    m.job.mockResolvedValue(null); m.knownJob.mockResolvedValue(null);
    await expect(beginChatPreparation("job")).rejects.toThrow("not committed");
    expect(m.verify).not.toHaveBeenCalled();
  });
  it("rechecks the exact preparation version, expiry and existing grant on every page", async () => {
    const plan = await beginChatPreparation("job");
    await assertChatPreparation(plan!);
    expect(m.job.mock.lastCall![0].where).toMatchObject({ id: "job", purpose: "chat", version: 0, expiresAt: { gt: expect.any(Date) }, grant: { revokedAt: null, leaseExpiresAt: { gt: expect.any(Date) } } });
    m.job.mockResolvedValue(null);
    await expect(assertChatPreparation(plan!)).rejects.toMatchObject({ code: "PREPARATION_ENDED" });
    await finishChatPreparation(plan!, []);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("never queues a replaced source or a partial material result", async () => {
    const plan = await beginChatPreparation("job");
    await expect(finishChatPreparation(plan!, [])).rejects.toMatchObject({ code: "INVALID_MATERIALS" });
    m.verify.mockRejectedValue(new PaperSourceError("SOURCE_CHANGED"));
    await expect(finishChatPreparation(plan!, [{ target: { kind: "presentation", id: "seminar", teamId: "team" }, objectKey: "presentations/private.pdf", assetId: "pdf", source: null }])).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects a seminar PDF replaced after verification but before the final material select", async () => {
    const plan = await beginChatPreparation("job");
    m.verify.mockImplementation(async () => {
      m.presentations.mockResolvedValue([{ id: "seminar", title: "주간 세미나", summary: null, keypoints: [], slides: [], assets: [{ id: "new-pdf", url: "presentations/replaced.pdf" }] }]);
    });
    await expect(finishChatPreparation(plan!, [{ target: { kind: "presentation", id: "seminar", teamId: "team" }, objectKey: "presentations/private.pdf", assetId: "pdf", source: { text: JSON.stringify([{ page: 1, text: "Old prepared seminar text" }]), digest: "a".repeat(64), pageCount: 1 } }])).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects a paper cache replaced after verification instead of substituting old text into the new row", async () => {
    const paperContext = JSON.stringify({ version: 1, kind: "research_chat", papers: [{ id: "paper", title: "Paper" }], presentations: [], history: [] });
    m.job.mockResolvedValue({ id: "job", teamId: "team", memberId: "member", version: 0, context: paperContext });
    const plan = await beginChatPreparation("job");
    m.verify.mockImplementation(async () => { m.papers.mockResolvedValue([{ id: "paper", title: "Paper", sourceText: JSON.stringify([{ page: 1, text: "New current paper text" }]) }]); });
    await expect(finishChatPreparation(plan!, [{ target: { kind: "paper", id: "paper", teamId: "team" }, objectKey: "papers/original.pdf", assetId: null, source: { text: JSON.stringify([{ page: 1, text: "Old prepared paper text" }]), digest: "a".repeat(64), pageCount: 1 } }])).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("holds the parent key lock and selected asset row until publishing the queue CAS in the same transaction", async () => {
    const plan = await beginChatPreparation("job");
    const prepared = { target: { kind: "presentation" as const, id: "seminar", teamId: "team" }, objectKey: "presentations/private.pdf", assetId: "pdf", source: { text: JSON.stringify([{ page: 1, text: "Verified seminar body" }]), digest: "a".repeat(64), pageCount: 1 } };
    await finishChatPreparation(plan!, [prepared]);
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.lockPresentation).toHaveBeenCalledWith({ where: { id: "seminar", teamId: "team" }, data: { id: "seminar" } });
    expect(m.lockAsset).toHaveBeenCalledWith({ where: { id: "pdf", presentationId: "seminar", type: "pdf", url: "presentations/private.pdf" }, data: { id: "pdf" } });
    expect(m.lockPresentation.mock.invocationCallOrder[0]).toBeLessThan(m.lockAsset.mock.invocationCallOrder[0]);
    expect(m.lockAsset.mock.invocationCallOrder[0]).toBeLessThan(m.presentations.mock.invocationCallOrder[0]);
    expect(m.presentations.mock.invocationCallOrder[0]).toBeLessThan(m.update.mock.invocationCallOrder[0]);
  });
  it("takes explicit parameterized PostgreSQL FOR UPDATE before the first parent UPDATE instead of relying on an unchanged id", async () => {
    const plan = await beginChatPreparation("job");
    await finishChatPreparation(plan!, [seminarSource()]);
    expect(m.raw).toHaveBeenCalledOnce();
    expect(m.raw.mock.calls[0][0].join("")).toContain('FROM "Presentation"');
    expect(m.raw.mock.calls[0][0].join("")).toContain('"teamId" = ');
    expect(m.raw.mock.calls[0][0].join("")).toContain("FOR UPDATE");
    expect(m.raw.mock.calls[0].slice(1)).toEqual(["seminar", "team"]);
    expect(m.raw.mock.invocationCallOrder[0]).toBeLessThan(m.lockPresentation.mock.invocationCallOrder[0]);
  });
  it("uses the isolated SQLite datasource despite Vitest's blocked PostgreSQL DATABASE_URL", async () => {
    vi.stubEnv("LOCAL_AGENT_TEST_CLIENT_MODULE", "C:/synthetic/client/index.js");
    vi.stubEnv("LOCAL_AGENT_TEST_DATABASE_URL", "file:C:/synthetic/agent.db");
    vi.stubEnv("HAPARK_ISOLATED_TESTS", "1");
    const plan = await beginChatPreparation("job");
    await finishChatPreparation(plan!, [seminarSource()]);
    expect(m.raw).not.toHaveBeenCalled();
    expect(m.lockPresentation).toHaveBeenCalledOnce();
    expect(m.update).toHaveBeenCalledOnce();
  });
  it("uses the explicit guarded PostgreSQL datasource rather than an unrelated DATABASE_URL", async () => {
    vi.stubEnv("LOCAL_AGENT_PG_TEST_CLIENT_MODULE", "C:/synthetic/pg-client/index.js");
    vi.stubEnv("LOCAL_AGENT_PG_TEST_URL", "postgresql://synthetic:synthetic@127.0.0.1:5439/hapark_local_agent_test");
    vi.stubEnv("HAPARK_PG_ISOLATED_TESTS", "1");
    vi.stubEnv("DATABASE_URL", "file:C:/synthetic/unrelated.db");
    const plan = await beginChatPreparation("job");
    await finishChatPreparation(plan!, [seminarSource()]);
    expect(m.raw).toHaveBeenCalledOnce();
  });
  it.each(["mixed-clients", "unguarded-client", "unsupported-url"])("fails closed for %s instead of silently skipping a required lock", async mode => {
    if (mode === "mixed-clients") {
      vi.stubEnv("LOCAL_AGENT_TEST_CLIENT_MODULE", "C:/synthetic/sqlite-client/index.js");
      vi.stubEnv("LOCAL_AGENT_PG_TEST_CLIENT_MODULE", "C:/synthetic/pg-client/index.js");
    } else if (mode === "unguarded-client") {
      vi.stubEnv("LOCAL_AGENT_PG_TEST_CLIENT_MODULE", "C:/synthetic/pg-client/index.js");
    } else vi.stubEnv("DATABASE_URL", "mysql://synthetic.invalid/db");
    const plan = await beginChatPreparation("job");
    await expect(finishChatPreparation(plan!, [seminarSource()])).rejects.toThrow("PDF source database configuration is invalid");
    expect(m.lockPresentation).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
});
