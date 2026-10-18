import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma, Job, AgentTask } from "@prisma/client";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { downloadObject, uploadGeneratedPresentation, assertGeneratedPresentationStorage } from "@/lib/storage";
import { countPdfPages, renderPdfPageToPng } from "@/lib/pdf-page-render";
import { sourceRevision } from "@/lib/agent/contract";
import type { LocalAgentScope } from "@/lib/local-agent/service";
import { SeminarDraftSchema, type SeminarDraft } from "./contract";
import { readSeminarWorkspace } from "./workflow";
import { ExportPayloadSchema, type ExportPayload, type SeminarExportView } from "./export-contract";
import { renderSeminarDeck, type DeckAsset } from "./render";

type Database = Prisma.TransactionClient;
const missing = () => new HttpError(404, "NOT_FOUND", "현재 팀에서 이 출력 파일을 찾을 수 없어요.");
const stale = () => new HttpError(409, "EXPORT_CHANGED", "논문이나 발표 내용이 바뀌었어요. 현재 내용을 확인하고 HTML/PDF를 다시 준비해주세요.");
export const seminarDraftHash = (draft: SeminarDraft) => createHash("sha256").update(JSON.stringify(SeminarDraftSchema.parse(draft))).digest("hex");
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Recheck immutable input against current domain state; this never renews PC authority. */
async function current(db: Database, input: ExportPayload, lock = false) {
  // Same task-before-membership order as reviewed save/export admission; both may finish together.
  const task = await db.agentTask.findFirst({ where: { id: input.taskId, teamId: input.teamId, memberId: input.memberId, paperId: input.paperId } });
  if (!task || task.kind !== "seminar" || ["queued", "running"].includes(task.status)) return false;
  if (lock && !(await db.agentTask.updateMany({ where: { id: task.id, version: task.version }, data: { version: task.version } })).count) return false;
  const member = await db.membership.findUnique({ where: { teamId_memberId: { teamId: input.teamId, memberId: input.memberId } } });
  if (!member) return false;
  if (lock && !(await db.membership.updateMany({ where: { teamId: input.teamId, memberId: input.memberId, role: member.role }, data: { role: member.role } })).count) return false;
  const draft = SeminarDraftSchema.safeParse(readSeminarWorkspace(task.draft)?.deck ?? task.draft);
  const paper = await db.paper.findFirst({ where: { id: input.paperId, teamId: input.teamId } });
  if (!draft.success || seminarDraftHash(draft.data) !== input.draftHash || !paper || sourceRevision(paper) !== input.sourceRevision) return false;
  if (lock && !(await db.paper.updateMany({ where: { id: paper.id, teamId: input.teamId, sourceDigest: paper.sourceDigest, sourceText: paper.sourceText, analysisRequestId: paper.analysisRequestId }, data: { analysisRequestId: paper.analysisRequestId } })).count) return false;
  return true;
}
export async function seminarExportView(db: Database, job: Job, input: ExportPayload): Promise<SeminarExportView> {
  const valid = await current(db, input);
  const ready = job.status === "done" && input.files && valid;
  return { id: job.id, status: job.status as SeminarExportView["status"], current: valid, error: job.lastError,
    files: ready ? (["html", "pdf"] as const).map(format => ({ format, href: `/api/agent/tasks/${encodeURIComponent(input.taskId)}/exports/${encodeURIComponent(job.id)}/file?format=${format}` })) : [], qa: input.qa ?? null };
}
async function owned(db: Database, scope: Pick<LocalAgentScope,"teamId"|"memberId">, taskId: string, jobId: string) {
  if (!await db.membership.findUnique({ where: { teamId_memberId: { teamId: scope.teamId, memberId: scope.memberId } } })) throw missing();
  const job = await db.job.findUnique({ where: { id: jobId } });
  const parsed = ExportPayloadSchema.safeParse(job?.payload);
  if (!job || job.type !== "seminar_export" || !parsed.success || parsed.data.taskId !== taskId || parsed.data.teamId !== scope.teamId || parsed.data.memberId !== scope.memberId) throw missing();
  if (!await db.agentTask.findFirst({ where: { id: taskId, teamId: scope.teamId, memberId: scope.memberId } })) throw missing();
  return { job, input: parsed.data };
}
export async function getSeminarExport(scope: LocalAgentScope, taskId: string, jobId: string) {
  const { job, input } = await owned(prisma, scope, taskId, jobId);
  return seminarExportView(prisma, job, input);
}
export async function latestSeminarExport(db: Database, taskId: string) {
  const op = await db.agentOperation.findFirst({ where: { taskId, kind: "export", tool: "seminar.export" }, orderBy: { createdAt: "desc" } });
  const id = (op?.output as { jobId?: unknown } | null)?.jobId;
  if (typeof id !== "string") return null;
  const job = await db.job.findUnique({ where: { id } }), parsed = ExportPayloadSchema.safeParse(job?.payload);
  return job && parsed.success ? seminarExportView(db, job, parsed.data) : null;
}
export async function verifySeminarAttachments(db: Database, task: AgentTask, presentationId: string, jobId: string, draft: SeminarDraft): Promise<boolean> {
  const job = await db.job.findUnique({ where: { id: jobId } }), parsed = ExportPayloadSchema.safeParse(job?.payload);
  if (!job || job.type !== "seminar_export" || job.status !== "done" || !parsed.success) return false;
  const input = parsed.data;
  if (input.taskId !== task.id || input.teamId !== task.teamId || input.memberId !== task.memberId || input.paperId !== task.paperId || input.sourceRevision !== task.sourceRevision || input.draftHash !== seminarDraftHash(draft) || !input.files || !input.qa || input.qa.issues.length) return false;
  const assets = await db.presentationAsset.findMany({ where: { presentationId,presentation: { teamId: task.teamId },url: { in: [input.files.pdf.path,input.files.html.path] } },select: { type: true,url: true } });
  return assets.some(asset => asset.type === "pdf" && asset.url === input.files!.pdf.path) && assets.some(asset => asset.type === "html" && asset.url === input.files!.html.path);
}
export async function downloadSeminarExport(scope: LocalAgentScope, taskId: string, jobId: string, format: "pdf" | "html") {
  const { job, input } = await owned(prisma, scope, taskId, jobId);
  if (!await current(prisma, input)) throw stale();
  if (job.status !== "done" || !input.files) throw new HttpError(409, "EXPORT_PENDING", "아직 출력 파일을 준비하고 있어요.");
  assertGeneratedPresentationStorage();
  return { bytes: await downloadObject(input.files[format].path), title: input.draft.title, contentType: format === "pdf" ? "application/pdf" : "text/html; charset=utf-8" };
}
/** Only a verified export of this exact reviewed snapshot may become a shared attachment. */
export async function attachSeminarExport(db: Database, scope: LocalAgentScope, taskId: string, presentationId: string, jobId: string, draft: SeminarDraft) {
  const { job, input } = await owned(db, scope, taskId, jobId);
  if (job.status !== "done" || !input.files || !input.qa || input.qa.issues.length || input.draftHash !== seminarDraftHash(draft) || !await current(db, input)) throw stale();
  const target = { id: presentationId, teamId: scope.teamId, presenterId: scope.memberId, sourcePaperId: input.paperId };
  let presentation = await db.presentation.findFirst({ where: target });
  if (!presentation || !(await db.presentation.updateMany({ where: { ...target,title: presentation.title },data: { title: presentation.title } })).count) throw stale();
  presentation = await db.presentation.findFirst({ where: target });
  if (!presentation || presentation.title !== draft.title || presentation.summary !== draft.summary || presentation.duration !== `${draft.durationMinutes}분` || presentation.slideCount !== draft.slides.length || !isDeepStrictEqual(presentation.keypoints,draft.keypoints) || !isDeepStrictEqual(presentation.slides,draft.slides)) throw stale();
  for (const format of ["pdf", "html"] as const) {
    const file = input.files[format];
    if (!await db.presentationAsset.findFirst({ where: { presentationId, url: file.path } })) await db.presentationAsset.create({ data: { presentationId, name: `${draft.title}.${format}`, type: format, url: file.path, size: `${(file.bytes/1024/1024).toFixed(1)} MB` } });
  }
}

async function sourceAssets(input: ExportPayload) {
  const result = new Map<string, DeckAsset>(); let original: Buffer | null = null;
  const originalPage = async (page: number) => {
    if (!original) { const paper = await prisma.paper.findFirst({ where: { id: input.paperId, teamId: input.teamId }, select: { pdfUrl: true } }); if (!paper?.pdfUrl) throw stale(); original = await downloadObject(paper.pdfUrl); }
    if (page < 1 || page > countPdfPages(original)) throw new Error("원문 그림의 페이지를 확인해주세요.");
    return renderPdfPageToPng(original, page-1);
  };
  for (const slide of input.draft.slides) {
    const visual = slide.visual; if (!visual || (visual.kind !== "figure" && visual.kind !== "page")) continue;
    const key = visual.kind === "figure" ? `figure:${visual.figureId}` : `page:${visual.page}`;
    if (result.has(key)) continue;
    let bytes: Buffer;
    if (visual.kind === "figure") {
      const figure = await prisma.figure.findFirst({ where: { id: visual.figureId, paperId: input.paperId, paper: { teamId: input.teamId } }, select: { imageUrl: true, sourcePage: true } });
      if (!figure) throw new Error("현재 논문에서 사용할 그림을 찾을 수 없어요.");
      // Never fetch model-supplied URLs. Only catalogued private objects or a verified original page.
      bytes = figure.imageUrl ? await downloadObject(figure.imageUrl) : await originalPage(figure.sourcePage);
    } else bytes = await originalPage(visual.page);
    const image = await sharp(bytes, { limitInputPixels: 50_000_000 }).resize({ width: 1800, height: 1400, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    result.set(key, { bytes: image.data, mime: "image/png", width: image.info.width, height: image.info.height });
  }
  return result;
}
/** Durable worker entry: fixed native renderer, no model/code execution and no request-path rendering. */
export async function runSeminarExport(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } }), parsed = ExportPayloadSchema.safeParse(job?.payload);
  if (!job || job.type !== "seminar_export" || job.status === "done" || job.status === "failed") return;
  if (!parsed.success || (job.attempts >= job.maxAttempts && (job.status === "queued" || !job.claimedAt || job.claimedAt.getTime() < Date.now()-600_000))) {
    await prisma.job.updateMany({ where: { id: jobId, status: job.status, attempts: job.attempts, claimedAt: job.claimedAt }, data: { status: "failed", lastError: "출력 작업을 완료하지 못했어요. 현재 내용으로 HTML/PDF를 다시 준비해주세요." } }); return;
  }
  const claimedAt = new Date();
  const claimed = await prisma.job.updateMany({ where: { id: jobId, attempts: { lt: job.maxAttempts }, OR: [{ status: "queued" }, { status: "running", claimedAt: { lt: new Date(Date.now()-600_000) } }] }, data: { status: "running", claimedAt, attempts: { increment: 1 }, lastError: null } });
  if (!claimed.count) return;
  const input = parsed.data;
  try {
    if (!await current(prisma, input)) throw stale();
    const rendered = await renderSeminarDeck(input.draft, await sourceAssets(input));
    if (countPdfPages(Buffer.from(rendered.pdf)) !== input.draft.slides.length) throw new Error("출력한 PDF의 페이지 수를 확인해주세요.");
    // Rasterize every generated page as part of renderer verification, including embedded fonts/images.
    for (let page = 0; page < input.draft.slides.length; page++) await sharp(renderPdfPageToPng(Buffer.from(rendered.pdf),page)).resize({ width: 640 }).stats();
    const prefix = `seminars/${input.teamId}/${input.memberId}/${input.taskId}/${jobId}/${randomUUID()}`;
    const pdf = Buffer.from(rendered.pdf), html = Buffer.from(rendered.html,"utf8");
    const files = { pdf: { path: `${prefix}.pdf`, bytes: pdf.length }, html: { path: `${prefix}.html`, bytes: html.length } };
    await uploadGeneratedPresentation(files.pdf.path,pdf,"application/pdf");
    await uploadGeneratedPresentation(files.html.path,html,"application/octet-stream");
    await prisma.$transaction(async tx => {
      if (!await current(tx,input,true)) throw stale();
      const done = await tx.job.updateMany({ where: { id: jobId, status: "running", claimedAt }, data: { status: "done", payload: json({ ...input, files, qa: rendered.qa }), lastError: null } });
      if (!done.count) throw stale();
      const saved = await tx.agentOperation.findFirst({ where: { taskId: input.taskId, kind: "save", tool: "seminar.save_reviewed", status: "completed" } });
      const presentationId = (saved?.output as { presentationId?: unknown } | null)?.presentationId;
      if (typeof presentationId === "string") await attachSeminarExport(tx,{ teamId: input.teamId, memberId: input.memberId, sessionKey: "accepted-export", sessionExpiresAt: new Date() },input.taskId,presentationId,jobId,input.draft);
    });
  } catch (cause) {
    const error = cause instanceof HttpError ? cause.message : cause instanceof Error && /[가-힣]/.test(cause.message) ? cause.message.slice(0,500) : "발표 파일을 준비하지 못했어요. 잠시 후 현재 내용으로 다시 준비해주세요.";
    await prisma.job.updateMany({ where: { id: jobId, status: "running", claimedAt }, data: { status: "failed", lastError: error } });
  }
}
