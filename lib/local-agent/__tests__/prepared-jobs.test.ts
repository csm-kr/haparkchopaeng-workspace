// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const db = {
    membership: { findUnique: vi.fn() },
    localAgentDevice: { findFirst: vi.fn(), updateMany: vi.fn() },
    localAgentGrant: { findFirst: vi.fn(), updateMany: vi.fn() },
    localAgentSnapshot: { findUnique: vi.fn() },
    paper: { findFirst: vi.fn() },
    researchConversation: { findFirst: vi.fn() },
    localAgentJob: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn() },
  };
  return { db, prisma: { ...db, $transaction: vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db)) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: fixture.prisma }));
import { acknowledgeDesktop, assertJobTarget, createPreparedJob, type LocalAgentScope } from "../service";
const scope = (): LocalAgentScope => ({ teamId: "team", memberId: "member", sessionKey: "session", sessionExpiresAt: new Date(Date.now() + 100_000) });
const input = () => ({ deviceId: "device", paperId: "paper", provider: "codex" as const, model: "actual", prompt: "서버가 구성한 분석 요청", requestId: "cbcf8003-7f9a-40ca-ab7a-aa62831c4617" });

beforeEach(() => {
  vi.clearAllMocks();
  fixture.db.membership.findUnique.mockResolvedValue({ memberId: "member" });
  fixture.db.localAgentDevice.findFirst.mockResolvedValue({ id: "device" });
  fixture.db.localAgentDevice.updateMany.mockResolvedValue({ count: 1 });
  fixture.db.localAgentGrant.findFirst.mockResolvedValue({ id: "grant", revokedAt: null, leaseExpiresAt: new Date(Date.now() + 45_000) });
  fixture.db.localAgentGrant.updateMany.mockResolvedValue({ count: 1 });
  fixture.db.localAgentSnapshot.findUnique.mockResolvedValue({ observedAt: new Date(), payload: { provider: "codex", status: "ready", models: [{ id: "actual", name: "Actual" }], quota: null, observedAt: new Date().toISOString() } });
  fixture.db.paper.findFirst.mockResolvedValue({ id: "paper" });
  fixture.db.researchConversation.findFirst.mockResolvedValue({ id: "conversation" });
  fixture.db.localAgentJob.findUnique.mockResolvedValue(null);
  fixture.db.localAgentJob.count.mockResolvedValue(0);
  fixture.db.localAgentJob.create.mockImplementation(async ({ data }) => ({ ...data, id: "job", version: 0, status: data.status ?? "queued", response: "", error: null, createdAt: new Date(), updatedAt: new Date() }));
});

describe("server-prepared local execution", () => {
  it("queues a private free-chat turn without requiring a paper", async () => {
    const job = await createPreparedJob(scope(), { ...input(), paperId: "" }, '{"kind":"research_chat","papers":[],"history":[]}', { purpose: "chat", conversationId: "conversation", conversationTurn: 1 });
    expect(job.id).toBe("job");
    expect(fixture.db.paper.findFirst).not.toHaveBeenCalled();
    expect(fixture.db.localAgentJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({ paperId: "", purpose: "chat", status: "queued" }) });
    await expect(createPreparedJob(scope(), { ...input(), paperId: "" }, "source", { purpose: "paper_analysis" })).rejects.toMatchObject({ status: 400 });
  });
  it("keeps material preparation out of the claimable queue and counts it against admission limits", async () => {
    const options = { purpose: "chat" as const, conversationId: "conversation", conversationTurn: 1, initialStatus: "preparing" as const };
    expect((await createPreparedJob(scope(), input(), "captured material context", options)).status).toBe("preparing");
    fixture.db.localAgentJob.count.mockImplementation(async ({ where }) => ["preparing", "preparing", "preparing", "preparing", "preparing"].filter(status => where.status.in.includes(status)).length);
    await expect(createPreparedJob(scope(), input(), "captured material context", options)).rejects.toMatchObject({ code: "QUEUE_FULL" });
    expect(fixture.db.localAgentJob.create).toHaveBeenCalledTimes(1);
  });
  it("names the AI Bridge app when rejecting invalid device credentials", async () => {
    await expect(acknowledgeDesktop({ attemptId: "attempt", launchToken: "launch", deviceToken: "invalid", deviceName: "PC", platform: "windows" }))
      .rejects.toMatchObject({ status: 400, code: "BAD_REQUEST", message: "AI 브릿지 정보를 확인해주세요." });
  });
  it("stores trusted raw source context and an explicit analysis purpose through existing admission", async () => {
    const context = '[{"page":1,"text":"원문에만 있는 새로운 증거"}]';
    const job = await createPreparedJob(scope(), input(), context, { purpose: "paper_analysis" });
    expect(job.id).toBe("job");
    expect(fixture.db.localAgentJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({ context, purpose: "paper_analysis", conversationId: null, conversationTurn: null, teamId: "team", memberId: "member", sessionKey: "session" }) });
    expect(fixture.db.paper.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "paper", teamId: "team" } }));
  });
  it("validates a target without changing device presence or renewing its web grant", async () => {
    await assertJobTarget(scope(), input());
    expect(fixture.db.localAgentDevice.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "device", memberId: "member", teamId: "team", revokedAt: null } }));
    expect(fixture.db.localAgentDevice.updateMany).not.toHaveBeenCalled();
    expect(fixture.db.localAgentGrant.updateMany).not.toHaveBeenCalled();
    expect(fixture.db.localAgentJob.create).not.toHaveBeenCalled();
    fixture.db.localAgentDevice.findFirst.mockResolvedValue(null);
    await expect(assertJobTarget(scope(), input())).rejects.toMatchObject({ status: 403 });
  });
  it("rejects effort levels absent from the actual model catalog before queuing", async () => {
    fixture.db.localAgentSnapshot.findUnique.mockResolvedValue({ observedAt: new Date(), payload: { provider: "codex", status: "ready", models: [{ id: "actual", name: "Actual", reasoningEfforts: ["low", "medium"] }], quota: null, observedAt: new Date().toISOString() } });
    await expect(createPreparedJob(scope(), input(), "context", { purpose: "chat", conversationId: "conversation", conversationTurn: 1, effort: "high" })).rejects.toMatchObject({ code: "EFFORT_UNAVAILABLE" });
    expect(fixture.db.localAgentJob.create).not.toHaveBeenCalled();
  });
  it("keeps legacy free chat available while rejecting an unverified explicit effort", async () => {
    const options = { purpose: "chat" as const, conversationId: "conversation", conversationTurn: 1 };
    await expect(createPreparedJob(scope(), { ...input(), paperId: "" }, "legacy context", { ...options, effort: "high" })).rejects.toMatchObject({ code: "EFFORT_UNAVAILABLE" });
    expect(fixture.db.localAgentJob.create).not.toHaveBeenCalled();
    expect((await createPreparedJob(scope(), { ...input(), paperId: "" }, "legacy context", options)).status).toBe("queued");
  });
  it("refuses stale catalogs, expired grants, overlong context and foreign conversations", async () => {
    fixture.db.localAgentSnapshot.findUnique.mockResolvedValue(null);
    await expect(assertJobTarget(scope(), input())).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    fixture.db.localAgentGrant.findFirst.mockResolvedValue({ revokedAt: null, leaseExpiresAt: new Date(0) });
    await expect(assertJobTarget(scope(), input())).rejects.toMatchObject({ status: 403 });
    await expect(createPreparedJob(scope(), input(), "x".repeat(250_001), { purpose: "paper_analysis" })).rejects.toMatchObject({ status: 400 });
    fixture.db.localAgentGrant.findFirst.mockResolvedValue({ id: "grant", revokedAt: null, leaseExpiresAt: new Date(Date.now() + 45_000) });
    fixture.db.researchConversation.findFirst.mockResolvedValue(null);
    await expect(createPreparedJob(scope(), input(), "원문", { purpose: "chat", conversationId: "foreign", conversationTurn: 1 })).rejects.toMatchObject({ status: 404 });
    expect(fixture.db.localAgentJob.create).not.toHaveBeenCalled();
  });
  it("does not reuse a question request ID as a prepared analysis or a different prepared context", async () => {
    fixture.db.localAgentJob.findUnique.mockResolvedValue({ ...input(), id: "old", purpose: "question", context: "old", conversationId: null, conversationTurn: null });
    await expect(createPreparedJob(scope(), input(), "원문", { purpose: "paper_analysis" })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
    fixture.db.localAgentJob.findUnique.mockResolvedValue({ ...input(), id: "old", purpose: "paper_analysis", context: "different", conversationId: null, conversationTurn: null });
    await expect(createPreparedJob(scope(), input(), "원문", { purpose: "paper_analysis" })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
  });
});
