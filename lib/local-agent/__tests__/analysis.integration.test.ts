// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
vi.mock("@/lib/prisma", async () => {
  const clientModule = process.env.LOCAL_AGENT_TEST_CLIENT_MODULE;
  if (!clientModule) return { prisma: {} };
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  require("../../../scripts/local-agent-verify.mjs").assertIsolatedDatabase(process.env.HAPARK_TEST_DIRECTORY, process.env.LOCAL_AGENT_TEST_DATABASE_URL);
  const { PrismaClient } = require(clientModule);
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.LOCAL_AGENT_TEST_DATABASE_URL } } }) };
});
vi.mock("@/lib/inngest", () => ({ inngest: { send: vi.fn().mockResolvedValue({ ids: ["fixture-event"] }) } }));
vi.mock("@/lib/storage", () => ({ signedDownloadUrl: vi.fn() }));
vi.mock("@/lib/figure-render", () => ({ renderFigures: vi.fn(async (_pdf, _id, figures) => figures) }));
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";
import { acknowledgeDesktop, claimJob, createAttempt, desktopHeartbeat, pairDesktop, revokeSession, submitResult, type LocalAgentScope } from "../service";
import { requestLocalAnalysis, prepareAnalysisRun, finishAnalysisRun, preparePaperSource, failAnalysisRun, cancelLocalAnalysis, readAnalysisJob, analysisSourceTarget } from "@/lib/local-ai/service";
import { preparePdfSource, type PdfSourceStep } from "@/worker/prepare-pdf-source";

const enabled = Boolean(process.env.LOCAL_AGENT_TEST_CLIENT_MODULE);
const scope = (): LocalAgentScope => ({ teamId: "analysis-test-team", memberId: "analysis-test-member", sessionKey: "analysis-web-session", sessionExpiresAt: new Date(Date.now() + 3_600_000) });
const text = "Our method reduces memory usage. We train for ten epochs with Adam.";
const context = JSON.stringify([{ page: 1, text }]);
const table = { caption: "미기재", columns: [], rows: [] };
function response() {
  return JSON.stringify({
    research: { problem: { oneLine: "메모리 사용 감소", setting: "원문 p.1", assumptions: [] }, contributions: ["메모리 사용 감소"], io: { inputs: [], outputs: [] }, comparison: table, ablation: table },
    repro: { data: table, model: { params: "미기재", items: [] }, loss: [], metrics: [], training: { caption: "원문 p.1", rows: [["epochs", "10"]] }, gpu: { hardware: "미기재", count: 0, vramGb: 0, vramUsedGb: 0, trainDays: 0, note: "미기재" }, repo: { found: false, url: null, summary: "외부 저장소 미확인", tree: [], source: "paper" }, diagram: { nodes: [], edges: [] } },
    figures: [], references: [{ lens: "research", sourcePage: 1, quote: "Our method reduces memory usage." }, { lens: "repro", sourcePage: 1, quote: "train for ten epochs with Adam" }],
  });
}
async function connected() {
  const attempt = await createAttempt(scope());
  const deviceToken = Buffer.alloc(32, 27).toString("base64url");
  await acknowledgeDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, deviceName: "분석 PC", platform: "windows" });
  const paired = await pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, code: attempt.code! });
  const identity = { deviceId: paired.deviceId!, deviceToken };
  await desktopHeartbeat(identity, [{ provider: "codex", status: "ready", models: [{ id: "fixture-model", name: "Fixture model" }], quota: null, observedAt: new Date().toISOString() }]);
  return { identity, input: { deviceId: identity.deviceId, provider: "codex" as const, model: "fixture-model", requestId: crypto.randomUUID() } };
}

describe.skipIf(!enabled)("PDF to local structured analysis durable boundary", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "analysis-isolated-fixture-only";
    await prisma.paper.deleteMany({ where: { teamId: scope().teamId } });
    await prisma.team.deleteMany({ where: { id: scope().teamId } });
    await prisma.job.deleteMany({ where: { type: "prepare_local_analysis" } });
    await prisma.team.create({ data: { id: scope().teamId, slug: "analysis-test-team", name: "분석 검증", createdBy: scope().memberId, memberships: { create: { memberId: scope().memberId, role: "owner" } } } });
    await prisma.paper.create({ data: { id: "analysis-test-paper", teamId: scope().teamId, title: "Fixture PDF", authors: "Researcher", pdfUrl: "papers/private-fixture.pdf", uploadedBy: scope().memberId, tags: [], pageCount: 1, sourceText: context, sourceDigest: "a".repeat(64), analysisStatus: "awaiting_ai" } });
  });
  afterAll(async () => {
    if (!enabled) return;
    await prisma.paper.deleteMany({ where: { teamId: scope().teamId } });
    await prisma.team.deleteMany({ where: { id: scope().teamId } });
    await prisma.job.deleteMany({ where: { type: "prepare_local_analysis" } });
    await prisma.$disconnect();
  });

  it("prepares original text without calling an AI and leaves an explicit waiting state", async () => {
    const document = await PDFDocument.create();
    document.addPage().drawText(text, { x: 30, y: 700, size: 12 });
    await prisma.paper.update({ where: { id: "analysis-test-paper" }, data: { sourceText: null, sourceDigest: null, analysisStatus: "pending" } });
    await preparePaperSource("analysis-test-paper", { loadPdf: async () => Buffer.from(await document.save()) });
    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: "analysis-test-paper" } });
    expect(paper.sourceText).toContain("reduces memory usage");
    expect(paper.analysisStatus).toBe("awaiting_ai");
    expect(await prisma.localAgentJob.count({ where: { teamId: scope().teamId } })).toBe(0);
  });

  it("accepts an explicit selection once and commits both validated lenses through the real queue", async () => {
    const { identity, input } = await connected();
    const run = await requestLocalAnalysis(scope(), "analysis-test-paper", input);
    expect(await requestLocalAnalysis(scope(), "analysis-test-paper", input)).toMatchObject({ runId: run.runId });
    expect(inngest.send).toHaveBeenCalledTimes(1);
    const prepared = await prepareAnalysisRun(run.runId);
    const claim = await claimJob(identity);
    expect(claim?.job.id).toBe(prepared.jobId);
    expect(claim?.context).toContain("reduces memory usage");
    expect(claim?.context).not.toContain("private-fixture.pdf");
    await submitResult(identity, { jobId: claim!.job.id, claimToken: claim!.claimToken, sequence: 1, status: "completed", response: response() });
    expect(await finishAnalysisRun(run.runId)).toBe("ready");
    expect(await finishAnalysisRun(run.runId)).toBe("ready");
    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: "analysis-test-paper" }, include: { analyses: true } });
    expect(paper.analysisStatus).toBe("ready");
    expect(paper.analyses).toHaveLength(2);
    expect(paper.analyses.find((a) => a.lens === "research")?.payload).toMatchObject({ problem: { oneLine: "메모리 사용 감소" } });
  });

  it("refuses malformed output and a superseded run without overwriting the newer analysis", async () => {
    const { identity, input } = await connected();
    const first = await requestLocalAnalysis(scope(), "analysis-test-paper", input);
    await prepareAnalysisRun(first.runId);
    const claim = await claimJob(identity);
    await submitResult(identity, { jobId: claim!.job.id, claimToken: claim!.claimToken, sequence: 1, status: "completed", response: '{"research":{}}' });
    expect(await finishAnalysisRun(first.runId)).toBe("failed");
    expect(await prisma.analysis.count({ where: { paperId: "analysis-test-paper" } })).toBe(0);
    const second = await requestLocalAnalysis(scope(), "analysis-test-paper", { ...input, requestId: crypto.randomUUID() });
    expect(await finishAnalysisRun(first.runId)).toBe("superseded");
    expect((await prisma.paper.findUniqueOrThrow({ where: { id: "analysis-test-paper" } })).analysisRequestId).toBe(second.runId);
  });

  it("rejects foreign papers and an expired web grant before enqueueing inference", async () => {
    const { input } = await connected();
    await expect(requestLocalAnalysis(scope(), "foreign-paper", input)).rejects.toMatchObject({ status: 404 });
    await prisma.localAgentGrant.updateMany({ where: { teamId: scope().teamId }, data: { leaseExpiresAt: new Date(0) } });
    await expect(requestLocalAnalysis(scope(), "analysis-test-paper", input)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.localAgentJob.count({ where: { teamId: scope().teamId } })).toBe(0);
  });

  it("stops the CLI queue atomically when its outer durable run fails", async () => {
    const { identity, input } = await connected();
    const run = await requestLocalAnalysis(scope(), "analysis-test-paper", input);
    const prepared = await prepareAnalysisRun(run.runId);
    await claimJob(identity);
    await failAnalysisRun(run.runId);
    expect((await prisma.localAgentJob.findUniqueOrThrow({ where: { id: prepared.jobId } })).status).toBe("cancelled");
    expect((await prisma.paper.findUniqueOrThrow({ where: { id: "analysis-test-paper" } })).analysisStatus).toBe("failed");
  });

  it("cancels during preparation without enqueueing a late analysis", async () => {
    const { input } = await connected();
    const run = await requestLocalAnalysis(scope(), "analysis-test-paper", input);
    await cancelLocalAnalysis(scope(), "analysis-test-paper");
    await expect(prepareAnalysisRun(run.runId)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.localAgentJob.count({ where: { teamId: scope().teamId } })).toBe(0);
  });
  it("stops OCR preparation at the next page when the real web grant expires", async () => {
    const { input } = await connected();
    const run = await requestLocalAnalysis(scope(), "analysis-test-paper", input);
    await expect(analysisSourceTarget(run.runId)).resolves.toMatchObject({ teamId: scope().teamId });
    await prisma.localAgentGrant.updateMany({ where: { teamId: scope().teamId }, data: { leaseExpiresAt: new Date(0) } });
    await expect(analysisSourceTarget(run.runId)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.localAgentJob.count({ where: { teamId: scope().teamId } })).toBe(0);
  });
  it("does not publish OCR text after cancellation between real durable page boundaries", async () => {
    const { input } = await connected();
    await prisma.paper.update({ where: { id: "analysis-test-paper" }, data: { sourceText: null, sourceDigest: null } });
    const run = await requestLocalAnalysis(scope(), "analysis-test-paper", input);
    const target = await analysisSourceTarget(run.runId);
    const bytes = Buffer.from("%PDF-synthetic-durable-cancel");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const recognize = vi.fn();
    const step = { run: async (name: string, action: () => Promise<unknown>) => {
      if (name.endsWith("-ocr-1")) await cancelLocalAnalysis(scope(), target.id);
      return action();
    } } as PdfSourceStep;
    await expect(preparePdfSource(target, step, async () => { await analysisSourceTarget(run.runId); }, {
      loadObject: async () => bytes,
      inspect: async () => ({ text: JSON.stringify([{ page: 1, text: "" }]), digest, pageCount: 1, ocrPages: [1] }), recognize,
    })).rejects.toMatchObject({ code: "SUPERSEDED" });
    expect(recognize).not.toHaveBeenCalled();
    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: target.id } });
    expect(paper.sourceText).toBeNull();
    expect(paper.analysisStatus).toBe("awaiting_ai");
    expect(await prisma.localAgentJob.count({ where: { teamId: scope().teamId } })).toBe(0);
  });
  it("preserves a newer source cache when the real cache CAS loses", async () => {
    const { input } = await connected();
    await prisma.paper.update({ where: { id: "analysis-test-paper" }, data: { sourceText: null, sourceDigest: null } });
    const run = await requestLocalAnalysis(scope(), "analysis-test-paper", input);
    const target = await analysisSourceTarget(run.runId);
    const newer = JSON.stringify([{ page: 1, text: "Newer source cache must survive." }]);
    const bytes = Buffer.from("%PDF-synthetic-durable-cas");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const step = { run: async (name: string, action: () => Promise<unknown>) => {
      if (name.endsWith("-cache")) await prisma.paper.update({ where: { id: target.id }, data: { sourceText: newer, sourceDigest: "b".repeat(64) } });
      return action();
    } } as PdfSourceStep;
    await expect(preparePdfSource(target, step, async () => { await analysisSourceTarget(run.runId); }, {
      loadObject: async () => bytes,
      inspect: async () => ({ text: context, digest, pageCount: 1, ocrPages: [] }),
    })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect((await prisma.paper.findUniqueOrThrow({ where: { id: target.id } })).sourceText).toBe(newer);
    expect(await prisma.localAgentJob.count({ where: { teamId: scope().teamId } })).toBe(0);
  });

  it("recovers a source cache written before the upload status and preserves an existing ready analysis", async () => {
    await prisma.paper.update({ where: { id: "analysis-test-paper" }, data: { analysisStatus: "pending", analysisRequestId: null } });
    const loadPdf = vi.fn();
    await preparePaperSource("analysis-test-paper", { loadPdf });
    expect((await prisma.paper.findUniqueOrThrow({ where: { id: "analysis-test-paper" } })).analysisStatus).toBe("awaiting_ai");
    await prisma.analysis.create({ data: { paperId: "analysis-test-paper", lens: "research", payload: { preserved: true } } });
    await prisma.paper.update({ where: { id: "analysis-test-paper" }, data: { analysisStatus: "ready" } });
    await preparePaperSource("analysis-test-paper", { loadPdf });
    expect(loadPdf).not.toHaveBeenCalled();
    expect((await prisma.paper.findUniqueOrThrow({ where: { id: "analysis-test-paper" } })).analysisStatus).toBe("ready");
    expect((await prisma.analysis.findUniqueOrThrow({ where: { paperId_lens: { paperId: "analysis-test-paper", lens: "research" } } })).payload).toEqual({ preserved: true });
  });

  it("stops a running CLI job on the next durable read after paper deletion", async () => {
    const { identity, input } = await connected();
    const run = await requestLocalAnalysis(scope(), "analysis-test-paper", input);
    const prepared = await prepareAnalysisRun(run.runId);
    const claimed = await claimJob(identity);
    await prisma.paper.delete({ where: { id: "analysis-test-paper" } });
    expect(await readAnalysisJob(run.runId)).toMatchObject({ id: prepared.jobId, status: "cancelled" });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: run.runId } })).status).toBe("failed");
    await expect(submitResult(identity, { jobId: prepared.jobId, claimToken: claimed!.claimToken, sequence: 1, status: "completed", response: response() })).rejects.toMatchObject({ status: 409 });
    expect(await finishAnalysisRun(run.runId)).toBe("superseded");
  });

  it("persists an already accepted completion after logout without restoring execution authority", async () => {
    const { identity, input } = await connected();
    const run = await requestLocalAnalysis(scope(), "analysis-test-paper", input);
    await prepareAnalysisRun(run.runId);
    const claimed = await claimJob(identity);
    await submitResult(identity, { jobId: claimed!.job.id, claimToken: claimed!.claimToken, sequence: 1, status: "completed", response: response() });
    await revokeSession(scope().sessionKey, scope().teamId);
    expect(await finishAnalysisRun(run.runId)).toBe("ready");
    expect(await prisma.analysis.count({ where: { paperId: "analysis-test-paper" } })).toBe(2);
    expect((await prisma.localAgentGrant.findFirstOrThrow({ where: { sessionKey: scope().sessionKey } })).revokedAt).not.toBeNull();
    await expect(requestLocalAnalysis(scope(), "analysis-test-paper", { ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses final persistence when the accepted result's owner is no longer a team member", async () => {
    const { identity, input } = await connected();
    const run = await requestLocalAnalysis(scope(), "analysis-test-paper", input);
    await prepareAnalysisRun(run.runId);
    const claimed = await claimJob(identity);
    await submitResult(identity, { jobId: claimed!.job.id, claimToken: claimed!.claimToken, sequence: 1, status: "completed", response: response() });
    // Force removal after getJob has authorized/read the completion but before
    // the real final transaction starts, exercising its membership recheck.
    const transaction = prisma.$transaction;
    const boundary = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (...args) => {
      await prisma.membership.delete({ where: { teamId_memberId: { teamId: scope().teamId, memberId: scope().memberId } } });
      return Reflect.apply(transaction, prisma, args);
    });
    try { await expect(finishAnalysisRun(run.runId)).rejects.toMatchObject({ status: 403 }); }
    finally { boundary.mockRestore(); }
    expect(await prisma.analysis.count({ where: { paperId: "analysis-test-paper" } })).toBe(0);
  });
});
