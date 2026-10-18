import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { inngest } from "@/lib/inngest";
import { signedDownloadUrl } from "@/lib/storage";
import { assertJobTarget, createPreparedJob, getJob, type LocalAgentScope } from "@/lib/local-agent/service";
import { extractPdfSource, parsePaperSource, PaperSourceError } from "./source";
import { LOCAL_ANALYSIS_PROMPT, parseLocalAnalysis } from "./payload";

export const LocalAnalysisRequestSchema = z.object({ deviceId: z.string().min(1).max(150), provider: z.enum(["codex", "claude"]), model: z.string().min(1).max(160), requestId: z.uuid() }).strict();
type Selection = z.infer<typeof LocalAnalysisRequestSchema>;
const Payload = z.object({
  paperId: z.string(),
  scope: z.object({ teamId: z.string(), memberId: z.string(), sessionKey: z.string(), sessionExpiresAt: z.iso.datetime() }).strict(),
  selection: LocalAnalysisRequestSchema,
  jobId: z.string().optional(),
}).strict();
export interface SourceDependencies { loadPdf(paperId: string): Promise<Buffer> }

async function loadPdf(paperId: string): Promise<Buffer> {
  const paper = await prisma.paper.findUnique({ where: { id: paperId }, select: { pdfUrl: true } });
  if (!paper) throw new HttpError(404, "NOT_FOUND", "논문을 찾을 수 없어요.");
  const url = await signedDownloadUrl(paper.pdfUrl, 120);
  const result = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!result.ok || !result.body || Number(result.headers.get("content-length")) > 20 * 1024 * 1024) throw new Error("PDF 파일을 불러오지 못했어요.");
  const reader = result.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const value = await reader.read();
      if (value.done) break;
      size += value.value.byteLength;
      if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("PDF 파일이 너무 커요."); }
      chunks.push(value.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

/** Upload preparation never calls an LLM. Reused by the explicitly requested analysis run. */
export async function preparePaperSource(paperId: string, deps: SourceDependencies = { loadPdf }) {
  const paper = await prisma.paper.findUnique({ where: { id: paperId } });
  if (!paper) throw new HttpError(404, "NOT_FOUND", "논문을 찾을 수 없어요.");
  let source: Awaited<ReturnType<typeof extractPdfSource>>;
  if (paper.sourceText && paper.sourceDigest) {
    const pages = parsePaperSource(paper.sourceText);
    source = { text: paper.sourceText, digest: paper.sourceDigest, pageCount: paper.pageCount ?? pages.length };
  } else {
    source = await extractPdfSource(await deps.loadPdf(paperId));
    await prisma.paper.updateMany({ where: { id: paperId, pdfUrl: paper.pdfUrl }, data: { sourceText: source.text, sourceDigest: source.digest, pageCount: source.pageCount } });
  }
  // A durable retry may start after the cache write but before this transition.
  // Existing ready analyses and explicit analysis runs keep their current state.
  await prisma.paper.updateMany({ where: { id: paperId, analysisRequestId: null, analysisStatus: "pending" }, data: { analysisStatus: "awaiting_ai", analysisStartedAt: null, analysisError: null } });
  return source;
}

async function runRecord(runId: string) {
  const record = await prisma.job.findUnique({ where: { id: runId } });
  const parsed = record?.type === "prepare_local_analysis" ? Payload.safeParse(record.payload) : null;
  if (!record || !parsed?.success) throw new HttpError(404, "NOT_FOUND", "분석 요청을 찾을 수 없어요.");
  return { record, payload: parsed.data, scope: { ...parsed.data.scope, sessionExpiresAt: new Date(parsed.data.scope.sessionExpiresAt) } };
}

export async function requestLocalAnalysis(scope: LocalAgentScope, paperId: string, selection: Selection) {
  const input = LocalAnalysisRequestSchema.parse(selection);
  const paper = await prisma.paper.findFirst({ where: { id: paperId, teamId: scope.teamId }, select: { id: true } });
  if (!paper) throw new HttpError(404, "NOT_FOUND", "이 팀에서 논문을 찾을 수 없어요.");
  await assertJobTarget(scope, input);
  const runId = `local-analysis-${createHash("sha256").update(JSON.stringify([scope.teamId, scope.memberId, scope.sessionKey, input.requestId])).digest("hex").slice(0, 40)}`;
  const payload = { paperId, scope: { ...scope, sessionExpiresAt: scope.sessionExpiresAt.toISOString() }, selection: input };
  const replay = async (db: Pick<Prisma.TransactionClient, "paper">, existing: { type: string; payload: unknown }) => {
    const prior = existing.type === "prepare_local_analysis" ? Payload.safeParse(existing.payload) : null;
    if (!prior?.success || prior.data.paperId !== paperId || prior.data.scope.teamId !== scope.teamId || prior.data.scope.memberId !== scope.memberId || prior.data.scope.sessionKey !== scope.sessionKey || JSON.stringify(prior.data.selection) !== JSON.stringify(input)) throw new HttpError(409, "REQUEST_ID_REUSED", "새 분석에는 새 요청 번호가 필요해요.");
    const current = await db.paper.findFirst({ where: { id: paperId, teamId: scope.teamId } });
    if (!current || current.analysisRequestId !== runId) throw new HttpError(409, "SUPERSEDED", "새 분석 요청으로 바뀌었어요. 상태를 확인해주세요.");
    return { created: false, analysisStatus: current.analysisStatus, analysisError: current.analysisError };
  };
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.paper.updateMany({ where: { id: paperId, teamId: scope.teamId }, data: { teamId: scope.teamId } });
    if (!locked.count) throw new HttpError(404, "NOT_FOUND", "논문을 찾을 수 없어요.");
    const existing = await tx.job.findUnique({ where: { id: runId } });
    if (existing) return replay(tx, existing);
    const previous = await tx.paper.findUniqueOrThrow({ where: { id: paperId } });
    if (previous.analysisRequestId) {
      const previousRun = await tx.job.findUnique({ where: { id: previous.analysisRequestId } });
      const old = Payload.safeParse(previousRun?.payload);
      if (old.success) {
        await tx.localAgentJob.updateMany({ where: { teamId: scope.teamId, memberId: old.data.scope.memberId, sessionKey: old.data.scope.sessionKey, requestId: old.data.selection.requestId, purpose: "paper_analysis", status: { in: ["queued", "running"] } }, data: { status: "cancelled", response: "", error: "새 분석 요청으로 이전 분석을 중단했어요.", version: { increment: 1 } } });
      }
    }
    await tx.job.create({ data: { id: runId, type: "prepare_local_analysis", status: "queued", payload } });
    await tx.paper.update({ where: { id: paperId }, data: { analysisRequestId: runId, analysisStatus: "pending", analysisStartedAt: new Date(), analysisError: null } });
    return { created: true, analysisStatus: "pending", analysisError: null };
  }).catch(async (error: unknown) => {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    // Different papers have different locks but share the session request ID.
    // Read only after the failed PostgreSQL transaction has fully rolled back.
    await assertJobTarget(scope, input);
    const existing = await prisma.job.findUnique({ where: { id: runId } });
    if (!existing) throw error;
    return replay(prisma, existing);
  });
  if (result.created) {
    try { await inngest.send({ name: "paper/analyze", data: { paperId, runId } }); }
    catch { await failAnalysisRun(runId, "분석 대기열에 연결하지 못했어요. 잠시 후 다시 시도해주세요."); throw new HttpError(503, "QUEUE_UNAVAILABLE", "분석을 시작하지 못했어요. 잠시 후 다시 시도해주세요."); }
  }
  return { id: paperId, runId, analysisStatus: result.analysisStatus, analysisError: result.analysisError };
}

function assertPreparationDeadline(record: { status: string; createdAt: Date }, sessionExpiresAt: Date): void {
  if (!["queued", "running"].includes(record.status) || sessionExpiresAt.getTime() <= Date.now()) throw new HttpError(409, "SUPERSEDED", "분석 요청이 끝났어요.");
  if (record.createdAt && Date.now() - record.createdAt.getTime() >= 600_000) throw new HttpError(409, "EXPIRED", "분석 준비 시간이 끝났어요. 다시 분석해주세요.");
}

/** Every OCR step rechecks the existing web authority; workers never renew it. */
export async function analysisSourceTarget(runId: string) {
  const { record, payload, scope } = await runRecord(runId);
  assertPreparationDeadline(record, scope.sessionExpiresAt);
  const paper = await prisma.paper.findFirst({ where: { id: payload.paperId, teamId: scope.teamId, analysisRequestId: runId, analysisStatus: "pending" }, select: { id: true } });
  if (!paper) throw new HttpError(409, "SUPERSEDED", "분석 요청이 바뀌거나 취소됐어요.");
  await assertJobTarget(scope, payload.selection);
  return { kind: "paper" as const, id: paper.id, teamId: scope.teamId };
}

/** Durable source preparation has finished before this short admission step. */
export async function prepareAnalysisRun(runId: string): Promise<{ jobId: string }> {
  const { record, payload, scope } = await runRecord(runId);
  const paper = await prisma.paper.findFirst({ where: { id: payload.paperId, teamId: scope.teamId, analysisRequestId: runId, analysisStatus: "pending" } });
  if (!paper) throw new HttpError(409, "SUPERSEDED", "새 분석 요청으로 바뀌었어요.");
  if (payload.jobId) return { jobId: payload.jobId };
  assertPreparationDeadline(record, scope.sessionExpiresAt);
  await assertJobTarget(scope, payload.selection);
  if (!paper.sourceText || !paper.sourceDigest) throw new HttpError(409, "SOURCE_NOT_READY", "논문 본문을 먼저 준비해주세요.");
  const pages = parsePaperSource(paper.sourceText);
  if (!pages.some(page => page.text.trim())) throw new PaperSourceError("INVALID_CACHE");
  const source = { text: paper.sourceText, digest: paper.sourceDigest };
  const context = JSON.stringify({ title: paper.title, authors: paper.authors, sourceDigest: source.digest, pages: parsePaperSource(source.text), capabilities: { textOnly: true, externalSearch: false, figurePixels: false } });
  return prisma.$transaction(async (tx) => {
    const locked = await tx.paper.updateMany({ where: { id: paper.id, teamId: scope.teamId, analysisRequestId: runId, analysisStatus: "pending", pdfUrl: paper.pdfUrl, sourceText: paper.sourceText, sourceDigest: paper.sourceDigest }, data: { analysisError: null } });
    if (!locked.count) throw new HttpError(409, "SUPERSEDED", "분석 요청이 바뀌거나 취소됐어요.");
    const current = await tx.job.findUniqueOrThrow({ where: { id: record.id } });
    assertPreparationDeadline(current, scope.sessionExpiresAt);
    const job = await createPreparedJob(scope, { ...payload.selection, paperId: paper.id, prompt: LOCAL_ANALYSIS_PROMPT }, context, { purpose: "paper_analysis", transaction: tx });
    assertPreparationDeadline(current, scope.sessionExpiresAt);
    await tx.job.update({ where: { id: record.id }, data: { status: "running", claimedAt: new Date(), payload: { ...payload, jobId: job.id } } });
    return { jobId: job.id };
  });
}

export async function getLocalAnalysisState(scope: LocalAgentScope, paperId: string) {
  const paper = await prisma.paper.findFirst({ where: { id: paperId, teamId: scope.teamId }, select: { id: true, analysisStatus: true, analysisError: true, analysisRequestId: true, sourceText: true } });
  if (!paper) throw new HttpError(404, "NOT_FOUND", "논문을 찾을 수 없어요.");
  const record = paper.analysisRequestId ? await prisma.job.findUnique({ where: { id: paper.analysisRequestId } }) : null;
  const payload = Payload.safeParse(record?.payload);
  let sourceHasOcr = false;
  try { sourceHasOcr = Boolean(paper.sourceText && parsePaperSource(paper.sourceText).some(page => page.method === "ocr")); }
  catch { /* Invalid legacy cache cannot turn a status read into an error. */ }
  return { id: paper.id, analysisStatus: paper.analysisStatus, analysisError: paper.analysisError, runId: paper.analysisRequestId, sourceReady: Boolean(paper.sourceText), sourceHasOcr, canCancel: Boolean(paper.analysisStatus === "pending" && payload.success && payload.data.scope.memberId === scope.memberId && payload.data.scope.sessionKey === scope.sessionKey) };
}

export async function cancelLocalAnalysis(scope: LocalAgentScope, paperId: string) {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.paper.updateMany({ where: { id: paperId, teamId: scope.teamId }, data: { teamId: scope.teamId } });
    if (!locked.count) throw new HttpError(404, "NOT_FOUND", "논문을 찾을 수 없어요.");
    const paper = await tx.paper.findUniqueOrThrow({ where: { id: paperId } });
    if (!paper.analysisRequestId || paper.analysisStatus !== "pending") return;
    const record = await tx.job.findUnique({ where: { id: paper.analysisRequestId } });
    const parsed = Payload.safeParse(record?.payload);
    if (!parsed.success || parsed.data.scope.memberId !== scope.memberId || parsed.data.scope.sessionKey !== scope.sessionKey) throw new HttpError(403, "FORBIDDEN", "이 로그인에서 시작한 분석만 중단할 수 있어요.");
    await tx.localAgentJob.updateMany({ where: { teamId: scope.teamId, memberId: scope.memberId, sessionKey: scope.sessionKey, requestId: parsed.data.selection.requestId, purpose: "paper_analysis", status: { in: ["queued", "running"] } }, data: { status: "cancelled", error: "분석을 중단했어요.", response: "", version: { increment: 1 } } });
    await tx.job.update({ where: { id: record!.id }, data: { status: "failed", lastError: "분석을 중단했어요." } });
    await tx.paper.update({ where: { id: paperId }, data: { analysisStatus: "awaiting_ai", analysisError: "분석을 중단했어요.", analysisStartedAt: null } });
  });
  return getLocalAnalysisState(scope, paperId);
}

export async function failAnalysisRun(runId: string, message = "분석을 완료하지 못했어요. 연결과 모델을 확인하고 다시 시도해주세요.") {
  const { payload } = await runRecord(runId);
  await prisma.$transaction(async (tx) => {
    // Match admission/cancellation lock order even for a superseded run. A
    // deleted paper has no row to lock, but its orphaned CLI job must still stop.
    await tx.paper.updateMany({ where: { id: payload.paperId, teamId: payload.scope.teamId }, data: { teamId: payload.scope.teamId } });
    await tx.localAgentJob.updateMany({ where: { teamId: payload.scope.teamId, memberId: payload.scope.memberId, sessionKey: payload.scope.sessionKey, requestId: payload.selection.requestId, purpose: "paper_analysis", status: { in: ["queued", "running"] } }, data: { status: "cancelled", response: "", error: message, version: { increment: 1 } } });
    await tx.paper.updateMany({ where: { id: payload.paperId, teamId: payload.scope.teamId, analysisRequestId: runId, analysisStatus: "pending" }, data: { analysisStatus: "failed", analysisError: message } });
    await tx.job.updateMany({ where: { id: runId, status: { not: "done" } }, data: { status: "failed", lastError: message } });
  });
}

export async function readAnalysisJob(runId: string) {
  const { payload, scope } = await runRecord(runId);
  if (!payload.jobId) return null;
  const paper = await prisma.paper.findFirst({ where: { id: payload.paperId, teamId: scope.teamId, analysisRequestId: runId, analysisStatus: "pending" }, select: { id: true } });
  if (!paper) await failAnalysisRun(runId, "논문이 삭제되거나 새 분석 요청으로 바뀌었어요.");
  return getJob(scope, payload.jobId);
}

export async function finishAnalysisRun(runId: string): Promise<"ready" | "pending" | "failed" | "superseded"> {
  const { record, payload, scope } = await runRecord(runId);
  const paper = await prisma.paper.findFirst({ where: { id: payload.paperId, teamId: scope.teamId, analysisRequestId: runId } });
  if (!paper) return "superseded";
  if (record.status === "done") return "ready";
  if (record.status === "failed") return "failed";
  const job = payload.jobId ? await getJob(scope, payload.jobId) : null;
  if (!job || job.status === "queued" || job.status === "running") return "pending";
  if (job.status !== "completed") { await failAnalysisRun(runId, job.error || "연결한 AI가 분석을 완료하지 못했어요. 다시 연결해 분석해주세요."); return "failed"; }
  let parsed: ReturnType<typeof parseLocalAnalysis>;
  try { parsed = parseLocalAnalysis(job.response, paper.sourceText ?? ""); }
  catch { await failAnalysisRun(runId, "AI 분석의 형식·원문 근거를 확인하지 못했어요. 모델을 바꾸거나 다시 분석해주세요."); return "failed"; }
  let figures = parsed.figures;
  if (figures.length) {
    try {
      const { renderFigures } = await import("@/lib/figure-render");
      figures = await renderFigures(await loadPdf(paper.id), `${paper.id}/${runId}`, figures);
    }
    catch { /* Text and verified captions survive an unavailable image renderer. */ }
  }
  return prisma.$transaction(async (tx) => {
    // Paper comes first in prepare/cancel/failure as well. Taking Membership
    // first here would cycle with prepare's Device lock and member removal.
    const locked = await tx.paper.updateMany({ where: { id: paper.id, teamId: scope.teamId }, data: { teamId: scope.teamId } });
    if (!locked.count) return "superseded";
    const member = await tx.membership.updateMany({ where: { memberId: scope.memberId, teamId: scope.teamId }, data: { memberId: scope.memberId } });
    if (!member.count) throw new HttpError(403, "FORBIDDEN", "이 팀의 분석 저장 권한이 없어요.");
    const changed = await tx.paper.updateMany({ where: { id: paper.id, teamId: scope.teamId, analysisRequestId: runId, analysisStatus: "pending" }, data: { analysisStatus: "ready", analysisError: null, analysisDurationMs: paper.analysisStartedAt ? Math.max(0, Date.now() - paper.analysisStartedAt.getTime()) : null } });
    if (!changed.count) return (await tx.job.findUnique({ where: { id: runId } }))?.status === "done" ? "ready" : "superseded";
    for (const lens of ["research", "repro"] as const) {
      const value = parsed[lens] as unknown as Prisma.InputJsonValue;
      await tx.analysis.upsert({ where: { paperId_lens: { paperId: paper.id, lens } }, create: { paperId: paper.id, lens, payload: value }, update: { payload: value } });
    }
    await tx.figure.deleteMany({ where: { paperId: paper.id } });
    if (figures.length) await tx.figure.createMany({ data: figures.map(({ title, caption, interpretation, sourcePage, imageUrl }) => ({ paperId: paper.id, title, caption, interpretation, sourcePage, imageUrl })) });
    await tx.job.update({ where: { id: runId }, data: { status: "done", lastError: null } });
    return "ready";
  });
}
