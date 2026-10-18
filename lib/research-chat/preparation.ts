import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { downloadObject } from "@/lib/storage";
import { preparePaperSource } from "@/lib/local-ai/service";
import { extractPdfSource, knownSourceFailureMessage, sourceFailureMessage } from "@/lib/local-ai/source";
import { buildChatContext, effortFromContext, materialsFromContext } from "./context";
import { selectedPapers, selectedPresentations } from "./materials";

const History = z.array(z.object({ turn: z.number().int().nullable(), question: z.string(), answer: z.string() })).max(8);

/** Inngest only: a preparing job cannot be claimed by the connector. */
export async function prepareChatTurn(jobId: string): Promise<void> {
  const now = new Date();
  const usable = { status: "preparing", expiresAt: { gt: now }, grant: { revokedAt: null, leaseExpiresAt: { gt: now } }, device: { revokedAt: null } };
  const job = await prisma.localAgentJob.findFirst({ where: { id: jobId, purpose: "chat", ...usable } });
  if (!job) {
    // A durable event can arrive just before the admission transaction commits.
    if (!(await prisma.localAgentJob.findUnique({ where: { id: jobId }, select: { id: true } }))) throw new Error("Chat admission is not committed yet");
    return;
  }
  if (!(await prisma.membership.findUnique({ where: { teamId_memberId: { teamId: job.teamId, memberId: job.memberId } }, select: { memberId: true } }))) {
    throw new HttpError(403, "FORBIDDEN", "이 팀의 자료를 읽을 권한이 없어요.");
  }
  const materials = materialsFromContext(job.context);
  const [papers, presentations] = await Promise.all([
    selectedPapers(prisma, job.teamId, materials.filter(item => item.kind === "paper").map(item => item.id)),
    selectedPresentations(prisma, job.teamId, materials.filter(item => item.kind === "presentation").map(item => item.id)),
  ]);
  const readyPapers = [];
  for (const paper of papers) {
    const source = await preparePaperSource(paper.id);
    readyPapers.push({ ...paper, sourceText: source.text });
  }
  const readyPresentations = [];
  for (const presentation of presentations) {
    const asset = presentation.assets[0];
    if (asset && !asset.url.startsWith("presentations/")) throw new Error("Invalid stored seminar asset");
    const source = asset ? await extractPdfSource(await downloadObject(asset.url), { maxPages: 150 }) : null;
    const pages: { page: number; text: string }[] = source ? JSON.parse(source.text) : [];
    readyPresentations.push({ ...presentation, pages });
  }
  const previous: unknown = JSON.parse(job.context);
  const captured = previous && typeof previous === "object" && "history" in previous ? History.parse(previous.history) : [];
  const effort = effortFromContext(job.context);
  const { context } = buildChatContext(readyPapers, captured.map(item => ({ conversationTurn: item.turn, prompt: item.question, response: item.answer, status: "completed" })), readyPresentations, effort ? { effort } : undefined);
  const finished = JSON.parse(context);
  if (previous && typeof previous === "object" && "truncated" in previous && previous.truncated) finished.truncated = true;
  const checkedAt = new Date();
  await prisma.localAgentJob.updateMany({ where: { id: job.id, purpose: "chat", teamId: job.teamId, memberId: job.memberId, version: job.version,
    ...usable, expiresAt: { gt: checkedAt }, grant: { revokedAt: null, leaseExpiresAt: { gt: checkedAt } }, team: { memberships: { some: { memberId: job.memberId } } },
  }, data: { context: JSON.stringify(finished), status: "queued", version: { increment: 1 } } });
}

export async function failChatPreparation(jobId: string, cause: unknown): Promise<void> {
  const known = cause && typeof cause === "object" && "message" in cause ? knownSourceFailureMessage(cause.message) : null;
  await prisma.localAgentJob.updateMany({ where: { id: jobId, purpose: "chat", status: "preparing" }, data: {
    status: "failed", error: known ?? (cause instanceof Error ? sourceFailureMessage(cause) : "첨부 자료를 준비하지 못했어요. 파일을 확인하거나 자료를 빼고 다시 보내주세요."), version: { increment: 1 },
  } });
}
