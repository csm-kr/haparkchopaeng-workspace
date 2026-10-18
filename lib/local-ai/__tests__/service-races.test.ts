// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const m = vi.hoisted(() => {
  const paper = { findUnique: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() };
  const job = { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
  const db = { paper, job, localAgentJob: { updateMany: vi.fn() }, membership: { updateMany: vi.fn() }, analysis: { upsert: vi.fn() }, figure: { deleteMany: vi.fn(), createMany: vi.fn() }, $transaction: vi.fn() };
  return { db, target: vi.fn(), getJob: vi.fn(), parse: vi.fn(), send: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: m.db }));
vi.mock("@/lib/local-agent/service", () => ({ assertJobTarget: m.target, createPreparedJob: vi.fn(), getJob: m.getJob }));
vi.mock("@/lib/inngest", () => ({ inngest: { send: m.send } }));
vi.mock("@/lib/storage", () => ({ signedDownloadUrl: vi.fn() }));
vi.mock("@/lib/figure-render", () => ({ renderFigures: vi.fn() }));
vi.mock("@/lib/local-ai/payload", () => ({ LOCAL_ANALYSIS_PROMPT: "fixture", parseLocalAnalysis: m.parse }));
import { failAnalysisRun, finishAnalysisRun, preparePaperSource, readAnalysisJob, requestLocalAnalysis } from "../service";

const scope = { teamId: "team", memberId: "member", sessionKey: "session", sessionExpiresAt: new Date("2099-01-01T00:00:00Z") };
const selection = { deviceId: "pc", provider: "codex" as const, model: "actual-model", requestId: "188d0914-29da-4200-86aa-ab7551ff42dd" };
const requestRunId = `local-analysis-${createHash("sha256").update(JSON.stringify([scope.teamId, scope.memberId, scope.sessionKey, selection.requestId])).digest("hex").slice(0, 40)}`;
function run(id = "run", paperId = "p1") { return { id, type: "prepare_local_analysis", status: "running", payload: { paperId, scope: { ...scope, sessionExpiresAt: scope.sessionExpiresAt.toISOString() }, selection, jobId: "job" } }; }
beforeEach(() => {
  vi.resetAllMocks();
  m.db.$transaction.mockImplementation(async (input) => typeof input === "function" ? input(m.db) : Promise.all(input));
  m.target.mockResolvedValue(undefined); m.send.mockResolvedValue({ ids: [] });
  m.db.paper.updateMany.mockResolvedValue({ count: 1 });
  m.db.membership.updateMany.mockResolvedValue({ count: 1 });
  m.db.localAgentJob.updateMany.mockResolvedValue({ count: 1 });
  m.db.job.updateMany.mockResolvedValue({ count: 1 });
  m.db.job.update.mockResolvedValue({});
});

describe("durable analysis admission and lock recovery", () => {
  it("recovers a cached source left pending between two durable writes", async () => {
    m.db.paper.findUnique.mockResolvedValue({ id: "p1", pdfUrl: "private.pdf", sourceText: JSON.stringify([{ page: 1, text: "Original paper text for recovery." }]), sourceDigest: "a".repeat(64), pageCount: 1, analysisStatus: "pending", analysisRequestId: null });
    const loadPdf = vi.fn();
    await preparePaperSource("p1", { loadPdf });
    expect(loadPdf).not.toHaveBeenCalled();
    expect(m.db.paper.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", analysisRequestId: null, analysisStatus: "pending" }, data: expect.objectContaining({ analysisStatus: "awaiting_ai" }) }));
  });

  it("normalizes a cross-paper unique conflict only after the outer transaction rolls back", async () => {
    const unique = Object.assign(new Error("isolated unique conflict"), { code: "P2002" });
    let rolledBack = false;
    m.db.paper.findFirst.mockResolvedValue({ id: "p2", teamId: scope.teamId });
    m.db.paper.findUniqueOrThrow.mockResolvedValue({ id: "p2", analysisRequestId: null });
    m.db.job.findUnique.mockImplementation(async () => {
      if (!rolledBack) return null;
      return run("existing", "p1");
    });
    m.db.job.create.mockRejectedValue(unique);
    m.db.$transaction.mockImplementation(async (input) => { try { return await input(m.db); } catch (error) { rolledBack = true; throw error; } });
    await expect(requestLocalAnalysis(scope, "p2", selection)).rejects.toMatchObject({ status: 409, code: "REQUEST_ID_REUSED" });
    expect(rolledBack).toBe(true);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("returns the existing state for the same admitted request after a rolled-back duplicate", async () => {
    const unique = Object.assign(new Error("isolated unique conflict"), { code: "P2002" });
    let rolledBack = false;
    m.db.paper.findFirst.mockResolvedValue({ id: "p1", teamId: scope.teamId, analysisRequestId: requestRunId, analysisStatus: "pending", analysisError: null });
    m.db.paper.findUniqueOrThrow.mockResolvedValue({ id: "p1", analysisRequestId: requestRunId, analysisStatus: "pending", analysisError: null });
    m.db.job.findUnique.mockImplementation(async () => rolledBack ? run(requestRunId) : null);
    m.db.job.create.mockRejectedValue(unique);
    m.db.$transaction.mockImplementation(async (input) => { try { return await input(m.db); } catch (error) { rolledBack = true; throw error; } });
    await expect(requestLocalAnalysis(scope, "p1", selection)).resolves.toMatchObject({ analysisStatus: "pending" });
    expect(m.send).not.toHaveBeenCalled();
  });

  it("takes the paper lock before touching the CLI job during atomic failure cancellation", async () => {
    m.db.job.findUnique.mockResolvedValue(run());
    await failAnalysisRun("run");
    expect(m.db.paper.updateMany.mock.invocationCallOrder[0]).toBeLessThan(m.db.localAgentJob.updateMany.mock.invocationCallOrder[0]);
    expect(m.db.localAgentJob.updateMany.mock.invocationCallOrder[0]).toBeLessThan(m.db.job.updateMany.mock.invocationCallOrder[0]);
    expect(m.db.localAgentJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ["queued", "running"] } }), data: expect.objectContaining({ status: "cancelled", response: "" }) }));
  });

  it("takes the paper lock before the final membership lock to break the prepare/removal cycle", async () => {
    m.db.job.findUnique.mockResolvedValue(run());
    m.db.paper.findFirst.mockResolvedValue({ id: "p1", sourceText: "source", analysisStartedAt: null });
    m.getJob.mockResolvedValue({ status: "completed", response: "complete" });
    m.parse.mockReturnValue({ research: {}, repro: {}, figures: [] });
    await expect(finishAnalysisRun("run")).resolves.toBe("ready");
    expect(m.db.paper.updateMany.mock.invocationCallOrder[0]).toBeLessThan(m.db.membership.updateMany.mock.invocationCallOrder[0]);
    expect(m.db.membership.updateMany.mock.invocationCallOrder[0]).toBeLessThan(m.db.analysis.upsert.mock.invocationCallOrder[0]);
  });

  it("cancels the active local run when polling discovers its paper was deleted", async () => {
    m.db.job.findUnique.mockResolvedValue(run());
    m.db.paper.findFirst.mockResolvedValue(null);
    m.db.paper.updateMany.mockResolvedValue({ count: 0 });
    let cancelled = false;
    m.db.localAgentJob.updateMany.mockImplementation(async () => { cancelled = true; return { count: 1 }; });
    m.getJob.mockImplementation(async () => ({ status: cancelled ? "cancelled" : "running" }));
    await expect(readAnalysisJob("run")).resolves.toMatchObject({ status: "cancelled" });
    expect(m.db.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run", status: { not: "done" } }, data: expect.objectContaining({ status: "failed" }) }));
  });
});
