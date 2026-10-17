import type { LocalAgentJob, Prisma, ResearchConversation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { cancelJob, createPreparedJob, type LocalAgentScope } from "@/lib/local-agent/service";
import { knownSourceFailureMessage } from "@/lib/local-ai/source";
import type { LocalAgentJobStatus, LocalAgentProvider } from "@/types/local-agent";
import type { ResearchChatTurn, ResearchChatTurnInput, ResearchConversationCreateInput, ResearchConversationDetail, ResearchConversationView, ResearchPaperOption } from "@/types/research-chat";
import { buildChatContext, contextWasTruncated } from "./context";
import { ConversationCreateSchema, TurnCreateSchema } from "./validation";

type Database = Prisma.TransactionClient;
const active = ["queued", "running"];
const owner = (scope: LocalAgentScope) => ({ teamId: scope.teamId, memberId: scope.memberId });
function missing(): never { throw new HttpError(404, "NOT_FOUND", "연구 대화를 찾을 수 없어요."); }
function reused(): never { throw new HttpError(409, "REQUEST_ID_REUSED", "다른 대화나 질문에는 새 요청 번호가 필요해요."); }
function isUniqueConflict(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002"); }

async function membership(db: Database, scope: LocalAgentScope) {
  if (!(await db.membership.findUnique({ where: { teamId_memberId: owner(scope) }, select: { memberId: true } }))) throw new HttpError(403, "FORBIDDEN", "이 팀의 연구 대화에 접근할 수 없어요.");
}
function paperIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 || !value.every((id): id is string => typeof id === "string") || new Set(value).size !== value.length) throw new HttpError(409, "SOURCE_NOT_READY", "대화에 사용할 논문을 다시 선택해주세요.");
  return value;
}
function conversationView(row: ResearchConversation): ResearchConversationView {
  return { id: row.id, title: row.title, paperIds: paperIds(row.paperIds), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function turnView(row: LocalAgentJob, scope: LocalAgentScope): ResearchChatTurn {
  if (!row.conversationId || row.conversationTurn === null) missing();
  return { id: row.id, version: row.version, paperId: row.paperId, provider: row.provider as LocalAgentProvider, model: row.model,
    prompt: row.prompt, status: row.status as LocalAgentJobStatus, response: row.response, error: row.error,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), conversationId: row.conversationId,
    conversationTurn: row.conversationTurn, canCancel: row.sessionKey === scope.sessionKey && active.includes(row.status), contextTruncated: contextWasTruncated(row.context) };
}
async function ownedConversation(db: Database, scope: LocalAgentScope, id: string) {
  await membership(db, scope);
  const row = await db.researchConversation.findFirst({ where: { id, ...owner(scope) } });
  if (!row) missing();
  return row;
}
async function selectedPapers(db: Database, scope: LocalAgentScope, ids: string[]) {
  const rows = await db.paper.findMany({ where: { id: { in: ids }, teamId: scope.teamId }, select: { id: true, title: true, sourceText: true, analysisError: true } });
  const byId = new Map(rows.map(row => [row.id, row]));
  if (rows.length !== ids.length) throw new HttpError(404, "PAPER_NOT_FOUND", "이 팀에서 선택한 논문을 찾을 수 없어요.");
  return ids.map(id => byId.get(id)!);
}
function sourceOption(row: { id: string; title: string; sourceText: string | null; analysisError: string | null }): ResearchPaperOption {
  const sourceReady = Boolean(row.sourceText?.trim());
  return { id: row.id, title: row.title, sourceReady, sourceError: sourceReady ? null : knownSourceFailureMessage(row.analysisError) };
}
async function expireTurns(db: Database, scope: LocalAgentScope, conversationId: string) {
  const now = new Date();
  await db.localAgentJob.updateMany({ where: { ...owner(scope), conversationId, status: { in: active }, OR: [
    { expiresAt: { lte: now } }, { grant: { revokedAt: { not: null } } }, { grant: { leaseExpiresAt: { lte: now } } }, { device: { revokedAt: { not: null } } },
  ] }, data: { status: "cancelled", error: "웹 연결 권한이 끝났어요. AI를 다시 연결한 뒤 새 질문을 보내주세요.", version: { increment: 1 } } });
}

export async function listResearchPapers(scope: LocalAgentScope): Promise<ResearchPaperOption[]> {
  await membership(prisma, scope);
  const rows = await prisma.paper.findMany({ where: { teamId: scope.teamId }, select: { id: true, title: true, sourceText: true, analysisError: true }, orderBy: { uploadedAt: "desc" }, take: 100 });
  return rows.map(sourceOption);
}
export async function listConversations(scope: LocalAgentScope): Promise<ResearchConversationView[]> {
  await membership(prisma, scope);
  const rows = await prisma.researchConversation.findMany({ where: owner(scope), orderBy: { updatedAt: "desc" }, take: 100 });
  return rows.map(conversationView);
}
function sameConversation(row: ResearchConversation, scope: LocalAgentScope, input: ResearchConversationCreateInput) {
  if (row.teamId !== scope.teamId || row.memberId !== scope.memberId || JSON.stringify(paperIds(row.paperIds)) !== JSON.stringify(input.paperIds) || (input.title !== undefined && row.title !== input.title)) reused();
  return conversationView(row);
}
export async function createConversation(scope: LocalAgentScope, candidate: ResearchConversationCreateInput): Promise<ResearchConversationView> {
  const parsed = ConversationCreateSchema.safeParse(candidate);
  if (!parsed.success) throw new HttpError(400, "BAD_REQUEST", "대화 제목과 논문 1~3개를 확인해주세요.");
  const input = parsed.data;
  try {
    return await prisma.$transaction(async tx => {
      await membership(tx, scope);
      const existing = await tx.researchConversation.findUnique({ where: { id: input.requestId } });
      if (existing) return sameConversation(existing, scope, input);
      const papers = await selectedPapers(tx, scope, input.paperIds);
      const row = await tx.researchConversation.create({ data: { id: input.requestId, ...owner(scope), title: input.title ?? papers[0].title.slice(0, 120), paperIds: input.paperIds } });
      return conversationView(row);
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    await membership(prisma, scope);
    const existing = await prisma.researchConversation.findUnique({ where: { id: input.requestId } });
    if (!existing) throw error;
    return sameConversation(existing, scope, input);
  }
}
export async function getConversation(scope: LocalAgentScope, id: string): Promise<ResearchConversationDetail> {
  const row = await ownedConversation(prisma, scope, id);
  await expireTurns(prisma, scope, id);
  const [papers, turns] = await Promise.all([
    selectedPapers(prisma, scope, paperIds(row.paperIds)),
    prisma.localAgentJob.findMany({ where: { conversationId: id, purpose: "chat", ...owner(scope) }, orderBy: { conversationTurn: "desc" }, take: 51 }),
  ]);
  return { conversation: conversationView(row), papers: papers.map(sourceOption),
    turns: turns.slice(0, 50).reverse().map(turn => turnView(turn, scope)), hasEarlierTurns: turns.length > 50 };
}
function sameTurn(row: LocalAgentJob, scope: LocalAgentScope, id: string, input: ResearchChatTurnInput): ResearchChatTurn {
  if (row.conversationId !== id || row.purpose !== "chat" || row.deviceId !== input.deviceId || row.provider !== input.provider || row.model !== input.model || row.prompt !== input.prompt) reused();
  return turnView(row, scope);
}
export async function createTurn(scope: LocalAgentScope, id: string, candidate: ResearchChatTurnInput): Promise<ResearchChatTurn> {
  const parsed = TurnCreateSchema.safeParse(candidate);
  if (!parsed.success) throw new HttpError(400, "BAD_REQUEST", "연결한 PC와 모델, 질문을 확인해주세요.");
  const input = parsed.data;
  const key = { ...owner(scope), sessionKey: scope.sessionKey, requestId: input.requestId };
  try {
    return await prisma.$transaction(async tx => {
      await membership(tx, scope);
      // One row lock covers all devices/sessions that can write this conversation.
      const locked = await tx.researchConversation.updateMany({ where: { id, ...owner(scope) }, data: { updatedAt: new Date() } });
      if (!locked.count) missing();
      const row = await tx.researchConversation.findFirst({ where: { id, ...owner(scope) } });
      if (!row) missing();
      await expireTurns(tx, scope, id);
      const existing = await tx.localAgentJob.findUnique({ where: { teamId_memberId_sessionKey_requestId: key } });
      if (existing) return sameTurn(existing, scope, id, input);
      if (await tx.localAgentJob.count({ where: { conversationId: id, status: { in: active } } })) throw new HttpError(409, "CONVERSATION_BUSY", "이 대화의 답변이 진행 중이에요. 완료하거나 중지한 뒤 보내주세요.");
      const [papers, recent, latest] = await Promise.all([
        selectedPapers(tx, scope, paperIds(row.paperIds)),
        tx.localAgentJob.findMany({ where: { conversationId: id, purpose: "chat", status: "completed" }, orderBy: { conversationTurn: "desc" }, take: 9 }),
        tx.localAgentJob.findFirst({ where: { conversationId: id }, orderBy: { conversationTurn: "desc" }, select: { conversationTurn: true } }),
      ]);
      const { context } = buildChatContext(papers, recent);
      const nextTurn = (latest?.conversationTurn ?? 0) + 1;
      const accepted = await createPreparedJob(scope, { ...input, paperId: papers[0].id }, context, { purpose: "chat", conversationId: id, conversationTurn: nextTurn, transaction: tx });
      const job = await tx.localAgentJob.findUniqueOrThrow({ where: { id: accepted.id } });
      return turnView(job, scope);
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    await membership(prisma, scope);
    const existing = await prisma.localAgentJob.findUnique({ where: { teamId_memberId_sessionKey_requestId: key } });
    if (!existing) throw error;
    return sameTurn(existing, scope, id, input);
  }
}
export async function cancelTurn(scope: LocalAgentScope, conversationId: string, jobId: string): Promise<ResearchChatTurn> {
  await ownedConversation(prisma, scope, conversationId);
  const row = await prisma.localAgentJob.findFirst({ where: { id: jobId, conversationId, purpose: "chat", ...owner(scope), sessionKey: scope.sessionKey } });
  if (!row) missing();
  await cancelJob(scope, jobId);
  return turnView(await prisma.localAgentJob.findUniqueOrThrow({ where: { id: jobId } }), scope);
}
