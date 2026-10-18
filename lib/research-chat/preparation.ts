import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { knownSourceFailureMessage, parsePaperSource, PaperSourceError, sourceFailureMessage } from "@/lib/local-ai/source";
import { verifyPreparedPdfSource, type PreparedPdfSource } from "@/worker/prepare-pdf-source";
import { buildChatContext, effortFromContext, materialsFromContext } from "./context";
import { selectedPapers, selectedPresentations } from "./materials";

const History = z.array(z.object({ turn: z.number().int().nullable(), question: z.string(), answer: z.string() })).max(8);

export interface ChatPreparation {
  jobId: string;
  version: number;
  teamId: string;
  paperIds: string[];
  presentationIds: string[];
}
const usable = (now: Date) => ({ status: "preparing", expiresAt: { gt: now }, grant: { revokedAt: null, leaseExpiresAt: { gt: now } }, device: { revokedAt: null } });

async function currentJob(jobId: string, version?: number) {
  const job = await prisma.localAgentJob.findFirst({ where: { id: jobId, purpose: "chat", ...(version === undefined ? {} : { version }), ...usable(new Date()) } });
  if (!job) {
    // A durable event can arrive just before the admission transaction commits.
    if (!(await prisma.localAgentJob.findUnique({ where: { id: jobId }, select: { id: true } }))) throw new Error("Chat admission is not committed yet");
    return null;
  }
  if (!(await prisma.membership.findUnique({ where: { teamId_memberId: { teamId: job.teamId, memberId: job.memberId } }, select: { memberId: true } }))) {
    throw new HttpError(403, "FORBIDDEN", "이 팀의 자료를 읽을 권한이 없어요.");
  }
  return job;
}

/** Short step: capture identity/version only; the caller orchestrates PDF page steps. */
export async function beginChatPreparation(jobId: string): Promise<ChatPreparation | null> {
  const job = await currentJob(jobId);
  if (!job) return null;
  const materials = materialsFromContext(job.context);
  return { jobId, version: job.version, teamId: job.teamId,
    paperIds: materials.filter(item => item.kind === "paper").map(item => item.id),
    presentationIds: materials.filter(item => item.kind === "presentation").map(item => item.id) };
}

/** Rechecks the existing 45-second web grant without refreshing it. */
export async function assertChatPreparation(plan: ChatPreparation): Promise<void> {
  const job = await currentJob(plan.jobId, plan.version);
  if (!job || job.teamId !== plan.teamId) throw new HttpError(409, "PREPARATION_ENDED", "자료 준비가 취소되거나 연결 시간이 끝났어요.");
}

/** Only complete, revalidated sources are atomically published to the CLI queue. */
export async function finishChatPreparation(plan: ChatPreparation, prepared: PreparedPdfSource[]): Promise<void> {
  const job = await currentJob(plan.jobId, plan.version);
  if (!job || job.teamId !== plan.teamId) return;
  const materials = materialsFromContext(job.context);
  const keys = materials.map(item => `${item.kind}:${item.id}`);
  if (prepared.length !== keys.length || new Set(prepared.map(item => `${item.target.kind}:${item.target.id}`)).size !== keys.length ||
      prepared.some(item => item.target.teamId !== job.teamId || !keys.includes(`${item.target.kind}:${item.target.id}`))) throw new HttpError(409, "INVALID_MATERIALS", "첨부 자료를 다시 준비해주세요.");
  for (const source of prepared) await verifyPreparedPdfSource(source);
  await prisma.$transaction(async tx => {
    const ordered = [...prepared].sort((a, b) => {
      const left = `${a.target.kind}:${a.target.id}`, right = `${b.target.kind}:${b.target.id}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    // Parent rows precede assets and the queue row. id=id takes a PostgreSQL key
    // lock as well: a concurrent first-PDF insert must not bypass an empty snapshot.
    for (const source of ordered) {
      const locked = source.target.kind === "paper"
        ? await tx.paper.updateMany({ where: { id: source.target.id, teamId: job.teamId, pdfUrl: source.objectKey!,
          sourceText: source.source?.text ?? null, sourceDigest: source.source?.digest ?? null }, data: { id: source.target.id } })
        : await tx.presentation.updateMany({ where: { id: source.target.id, teamId: job.teamId }, data: { id: source.target.id } });
      if (!locked.count) throw new PaperSourceError("SOURCE_CHANGED");
    }
    for (const source of ordered) {
      if (source.target.kind !== "presentation" || !source.assetId) continue;
      const locked = await tx.presentationAsset.updateMany({ where: { id: source.assetId, presentationId: source.target.id,
        type: "pdf", url: source.objectKey! }, data: { id: source.assetId } });
      if (!locked.count) throw new PaperSourceError("SOURCE_CHANGED");
    }
    const [papers, presentations] = await Promise.all([
      selectedPapers(tx, job.teamId, plan.paperIds),
      selectedPresentations(tx, job.teamId, plan.presentationIds),
    ]);
    // Verification and this final material read can observe different generations.
    // Do not substitute an old prepared body into a newly selected material row.
    for (const paper of papers) {
      const source = prepared.find(item => item.target.kind === "paper" && item.target.id === paper.id);
      if (!source?.source || paper.sourceText !== source.source.text) throw new PaperSourceError("SOURCE_CHANGED");
    }
    for (const presentation of presentations) {
      const source = prepared.find(item => item.target.kind === "presentation" && item.target.id === presentation.id);
      const asset = presentation.assets[0];
      if (!source || (asset?.id ?? null) !== source.assetId || (asset?.url ?? null) !== source.objectKey) throw new PaperSourceError("SOURCE_CHANGED");
    }
    const sources = new Map(prepared.map(item => [`${item.target.kind}:${item.target.id}`, item.source]));
    const readyPapers = papers.map(paper => ({ ...paper, sourceText: sources.get(`paper:${paper.id}`)?.text ?? null }));
    const readyPresentations = presentations.map(presentation => {
      const source = sources.get(`presentation:${presentation.id}`);
      return { ...presentation, pages: source ? JSON.parse(source.text) : [] };
    });
    for (const paper of readyPapers) parsePaperSource(paper.sourceText ?? "");
    const previous: unknown = JSON.parse(job.context);
    const captured = previous && typeof previous === "object" && "history" in previous ? History.parse(previous.history) : [];
    const effort = effortFromContext(job.context);
    const { context } = buildChatContext(readyPapers, captured.map(item => ({ conversationTurn: item.turn, prompt: item.question, response: item.answer, status: "completed" })), readyPresentations, effort ? { effort } : undefined);
    const finished = JSON.parse(context);
    if (previous && typeof previous === "object" && "truncated" in previous && previous.truncated) finished.truncated = true;
    await tx.localAgentJob.updateMany({ where: { id: job.id, purpose: "chat", teamId: job.teamId, memberId: job.memberId, version: job.version,
      ...usable(new Date()), team: { memberships: { some: { memberId: job.memberId } } },
    }, data: { context: JSON.stringify(finished), status: "queued", version: { increment: 1 } } });
  });
}

export async function failChatPreparation(jobId: string, cause: unknown): Promise<void> {
  const known = cause && typeof cause === "object" && "message" in cause ? knownSourceFailureMessage(cause.message) : null;
  await prisma.localAgentJob.updateMany({ where: { id: jobId, purpose: "chat", status: "preparing" }, data: {
    status: "failed", error: known ?? (cause instanceof Error ? sourceFailureMessage(cause) : "첨부 자료를 준비하지 못했어요. 파일을 확인하거나 자료를 빼고 다시 보내주세요."), version: { increment: 1 },
  } });
}
