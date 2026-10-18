import { createHash } from "node:crypto";
import type { GetStepTools } from "inngest";
import type { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/prisma";
import { signedDownloadUrl } from "@/lib/storage";
import { HttpError } from "@/lib/http";
import {
  inspectPdfSource, mergePdfSource, parsePaperSource, PaperSourceError, MAX_PDF_BYTES,
  type PaperSource, type InspectedPaperSource,
} from "@/lib/local-ai/source";

export type PdfSourceTarget = { kind: "paper" | "presentation"; id: string; teamId: string };
export type PdfSourceStep = Pick<GetStepTools<typeof inngest>, "run">;
type SourceRequest = { kind: "paper"; id: string; teamId?: string } | { kind: "presentation"; id: string; teamId: string };
interface SourceTicket {
  target: PdfSourceTarget;
  objectKey: string | null;
  assetId: string | null;
  sourceText: string | null;
  sourceDigest: string | null;
  pageCount: number | null;
}
export interface PreparedPdfSource {
  target: PdfSourceTarget;
  objectKey: string | null;
  assetId: string | null;
  source: PaperSource | null;
}
interface Dependencies {
  loadObject(key: string, signal: AbortSignal): Promise<Buffer>;
  inspect: typeof inspectPdfSource;
  recognize(pdf: Buffer, options: { page: number; maxPages: number; expectedDigest: string; signal: AbortSignal; timeoutMs: number }): Promise<string>;
  now(): number;
}

/** One abort signal bounds signing and the streamed object download. */
async function loadObject(key: string, signal: AbortSignal): Promise<Buffer> {
  const url = await signedDownloadUrl(key, 120, { signal });
  signal.throwIfAborted();
  const result = await fetch(url, { signal, redirect: "error" });
  if (!result.ok || !result.body || Number(result.headers.get("content-length")) > MAX_PDF_BYTES) throw new PaperSourceError("INVALID_PDF");
  const reader = result.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const value = await reader.read();
      if (value.done) break;
      bytes += value.value.byteLength;
      if (bytes > MAX_PDF_BYTES) { await reader.cancel(); throw new PaperSourceError("INVALID_PDF"); }
      chunks.push(value.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
const defaults: Dependencies = {
  loadObject, inspect: inspectPdfSource, now: Date.now,
  recognize: async (pdf, options) => (await import("@/lib/local-ai/pdf-ocr")).recognizePdfPage(pdf, options),
};

async function readTicket(input: SourceRequest): Promise<SourceTicket> {
  if (input.kind === "paper") {
    const row = await prisma.paper.findFirst({ where: { id: input.id, ...(input.teamId ? { teamId: input.teamId } : {}) },
      select: { id: true, teamId: true, pdfUrl: true, sourceText: true, sourceDigest: true, pageCount: true } });
    if (!row) throw new HttpError(404, "PAPER_NOT_FOUND", "이 팀에서 논문을 찾을 수 없어요.");
    return { target: { kind: "paper", id: row.id, teamId: row.teamId }, objectKey: row.pdfUrl, assetId: null,
      sourceText: row.sourceText, sourceDigest: row.sourceDigest, pageCount: row.pageCount };
  }
  const row = await prisma.presentation.findFirst({ where: { id: input.id, teamId: input.teamId },
    select: { id: true, teamId: true, assets: { where: { type: "pdf" }, select: { id: true, url: true }, orderBy: { id: "asc" }, take: 1 } } });
  if (!row) throw new HttpError(404, "PRESENTATION_NOT_FOUND", "이 팀에서 세미나 자료를 찾을 수 없어요.");
  const asset = row.assets[0];
  if (asset && !asset.url.startsWith("presentations/")) throw new PaperSourceError("INVALID_PDF");
  return { target: { kind: "presentation", id: row.id, teamId: row.teamId }, objectKey: asset?.url ?? null,
    assetId: asset?.id ?? null, sourceText: null, sourceDigest: null, pageCount: null };
}

function sameObject(left: SourceTicket, right: SourceTicket): boolean {
  return left.target.teamId === right.target.teamId && left.objectKey === right.objectKey && left.assetId === right.assetId;
}
function cached(ticket: SourceTicket): PaperSource | null {
  if (!ticket.sourceText || !ticket.sourceDigest) return null;
  const pages = parsePaperSource(ticket.sourceText);
  if (!pages.some(page => page.text.trim())) throw new PaperSourceError("INVALID_CACHE");
  return { text: ticket.sourceText, digest: ticket.sourceDigest, pageCount: ticket.pageCount ?? pages.length };
}

async function sourceStep<T>(step: PdfSourceStep, id: string, action: () => Promise<T>): Promise<T> {
  const result = await step.run(id, async () => {
    try { return { ok: true as const, value: await action() }; }
    catch (error) {
      // Inngest's StepError drops prototype/code. Serialize only our own fixed code,
      // never a native exception message; unknown failures retain normal step retries.
      if (error instanceof PaperSourceError) return { ok: false as const, sourceErrorCode: error.code };
      throw error;
    }
  }) as unknown as { ok: true; value: T } | { ok: false; sourceErrorCode: PaperSourceError["code"] };
  if (!result.ok) throw new PaperSourceError(result.sourceErrorCode);
  // These steps return only JSON objects, arrays and primitives (never PDF buffers).
  return result.value;
}

/** The caller owns the enclosing durable function: never wrap this orchestrator in step.run. */
export async function preparePdfSource(
  input: SourceRequest,
  step: PdfSourceStep,
  guard: () => Promise<void> = async () => {},
  dependencies: Partial<Dependencies> = {},
): Promise<PreparedPdfSource> {
  const deps = { ...defaults, ...dependencies };
  const prefix = `pdf-${input.kind}-${input.id}`;
  const plan = await sourceStep(step, `${prefix}-inspect`, async () => {
    await guard();
    const ticket = await readTicket(input);
    const source = cached(ticket);
    if (source || !ticket.objectKey) return { ticket, source, inspected: null };
    const pdf = await deps.loadObject(ticket.objectKey, AbortSignal.timeout(20_000));
    await guard();
    const inspected = await deps.inspect(pdf, { maxPages: input.kind === "paper" ? 30 : 150 });
    await guard();
    if (!sameObject(ticket, await readTicket(ticket.target))) throw new PaperSourceError("SOURCE_CHANGED");
    return { ticket, source: null, inspected };
  });
  const results: { page: number; text: string }[] = [];
  for (const page of plan.inspected?.ocrPages ?? []) {
    results.push(await sourceStep(step, `${prefix}-ocr-${page}`, async () => {
      const started = deps.now();
      await guard();
      if (!sameObject(plan.ticket, await readTicket(plan.ticket.target))) throw new PaperSourceError("SOURCE_CHANGED");
      const downloadBudget = Math.min(20_000, 50_000 - (deps.now() - started));
      if (downloadBudget <= 0) throw new PaperSourceError("OCR_TIMEOUT");
      const pdf = await deps.loadObject(plan.ticket.objectKey!, AbortSignal.timeout(downloadBudget));
      if (createHash("sha256").update(pdf).digest("hex") !== plan.inspected!.digest) throw new PaperSourceError("SOURCE_CHANGED");
      await guard();
      const remaining = 50_000 - (deps.now() - started);
      if (remaining <= 0) throw new PaperSourceError("OCR_TIMEOUT");
      const timeoutMs = Math.min(40_000, remaining);
      const text = await deps.recognize(pdf, { page, maxPages: input.kind === "paper" ? 30 : 150,
        expectedDigest: plan.inspected!.digest, timeoutMs, signal: AbortSignal.timeout(timeoutMs) });
      await guard();
      if (!sameObject(plan.ticket, await readTicket(plan.ticket.target))) throw new PaperSourceError("SOURCE_CHANGED");
      return { page, text };
    }));
  }
  return sourceStep(step, `${prefix}-cache`, async () => {
    await guard();
    const current = await readTicket(plan.ticket.target);
    if (!sameObject(plan.ticket, current)) throw new PaperSourceError("SOURCE_CHANGED");
    const source = plan.source ?? (plan.inspected ? mergePdfSource(plan.inspected as InspectedPaperSource, results) : null);
    if (plan.ticket.target.kind === "paper" && source) {
      const sameCache = current.sourceText === source.text && current.sourceDigest === source.digest;
      if (!sameCache) {
        const changed = await prisma.paper.updateMany({ where: { id: current.target.id, teamId: current.target.teamId,
          pdfUrl: current.objectKey!, sourceText: plan.ticket.sourceText, sourceDigest: plan.ticket.sourceDigest },
        data: { sourceText: source.text, sourceDigest: source.digest, pageCount: source.pageCount } });
        if (!changed.count) throw new PaperSourceError("SOURCE_CHANGED");
      }
      await prisma.paper.updateMany({ where: { id: current.target.id, teamId: current.target.teamId,
        pdfUrl: current.objectKey!, sourceText: source.text, sourceDigest: source.digest, analysisRequestId: null, analysisStatus: "pending" },
      data: { analysisStatus: "awaiting_ai", analysisStartedAt: null, analysisError: null } });
    }
    return { target: plan.ticket.target, objectKey: plan.ticket.objectKey, assetId: plan.ticket.assetId, source };
  });
}

/** Finish-step recheck; a replayed source result cannot authorize a changed/deleted material. */
export async function verifyPreparedPdfSource(prepared: PreparedPdfSource): Promise<void> {
  const current = await readTicket(prepared.target);
  if (current.objectKey !== prepared.objectKey || current.assetId !== prepared.assetId ||
      (current.target.kind === "paper" && (current.sourceText !== prepared.source?.text || current.sourceDigest !== prepared.source?.digest))) {
    throw new PaperSourceError("SOURCE_CHANGED");
  }
}
