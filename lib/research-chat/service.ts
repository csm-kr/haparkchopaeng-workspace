import type { LocalAgentJob, Prisma, ResearchConversation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";
import { HttpError } from "@/lib/http";
import { cancelJob, createPreparedJob, type LocalAgentScope } from "@/lib/local-agent/service";
import { knownSourceFailureMessage } from "@/lib/local-ai/source";
import type { LocalAgentJobStatus, LocalAgentProvider } from "@/types/local-agent";
import type { ResearchChatTurn, ResearchChatTurnInput, ResearchConversationCreateInput, ResearchConversationDetail, ResearchConversationView, ResearchPaperOption, ResearchPresentationOption } from "@/types/research-chat";
import { buildChatContext, contextWasTruncated, effortFromContext, materialsFromContext } from "./context";
import { ConversationCreateSchema, TurnCreateSchema } from "./validation";
import { initialSelection, presentationOption, readSelection, selectedPapers, selectedPresentations, storeSelection } from "./materials";

type Database = Prisma.TransactionClient;
const active = ["preparing", "queued", "running"];
const owner = (scope: LocalAgentScope) => ({ teamId: scope.teamId, memberId: scope.memberId });
function missing(): never { throw new HttpError(404, "NOT_FOUND", "연구 대화를 찾을 수 없어요."); }
function reused(): never { throw new HttpError(409, "REQUEST_ID_REUSED", "다른 대화나 질문에는 새 요청 번호가 필요해요."); }
function isUniqueConflict(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002"); }

async function membership(db: Database, scope: LocalAgentScope) {
  if (!(await db.membership.findUnique({ where: { teamId_memberId: owner(scope) }, select: { memberId: true } }))) throw new HttpError(403, "FORBIDDEN", "이 팀의 연구 대화에 접근할 수 없어요.");
}
function conversationView(row: ResearchConversation): ResearchConversationView {
  return { id: row.id, title: row.title, ...readSelection(row.paperIds), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function turnView(row: LocalAgentJob, scope: LocalAgentScope): ResearchChatTurn {
  if (!row.conversationId || row.conversationTurn === null) missing();
  return { id: row.id, version: row.version, paperId: row.paperId, provider: row.provider as LocalAgentProvider, model: row.model,
    prompt: row.prompt, status: row.status as LocalAgentJobStatus, response: row.response, error: row.error,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), conversationId: row.conversationId,
    conversationTurn: row.conversationTurn, canCancel: row.sessionKey === scope.sessionKey && active.includes(row.status), contextTruncated: contextWasTruncated(row.context), materials: materialsFromContext(row.context), effort: effortFromContext(row.context) };
}
async function ownedConversation(db: Database, scope: LocalAgentScope, id: string) {
  await membership(db, scope);
  const row = await db.researchConversation.findFirst({ where: { id, ...owner(scope) } });
  if (!row) missing();
  return row;
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
export async function listResearchPresentations(scope: LocalAgentScope): Promise<ResearchPresentationOption[]> {
  await membership(prisma, scope);
  const rows = await prisma.presentation.findMany({ where: { teamId: scope.teamId }, select: { id: true, title: true, date: true }, orderBy: { date: "desc" }, take: 100 });
  return rows.map(presentationOption);
}
export async function listConversations(scope: LocalAgentScope): Promise<ResearchConversationView[]> {
  await membership(prisma, scope);
  const rows = await prisma.researchConversation.findMany({ where: owner(scope), orderBy: { updatedAt: "desc" }, take: 100 });
  return rows.map(conversationView);
}
function sameConversation(row: ResearchConversation, scope: LocalAgentScope, input: ResearchConversationCreateInput) {
  const selected = initialSelection(row.paperIds);
  if (row.teamId !== scope.teamId || row.memberId !== scope.memberId || (input.title !== undefined && row.title !== input.title)) reused();
  if (JSON.stringify(selected.paperIds) !== JSON.stringify(input.paperIds ?? []) || JSON.stringify(selected.presentationIds) !== JSON.stringify(input.presentationIds ?? [])) reused();
  return conversationView(row);
}
export async function createConversation(scope: LocalAgentScope, candidate: ResearchConversationCreateInput): Promise<ResearchConversationView> {
  const parsed = ConversationCreateSchema.safeParse(candidate);
  if (!parsed.success) throw new HttpError(400, "BAD_REQUEST", "대화 제목과 선택한 자료를 확인해주세요.");
  const input = parsed.data;
  try {
    return await prisma.$transaction(async tx => {
      await membership(tx, scope);
      const existing = await tx.researchConversation.findUnique({ where: { id: input.requestId } });
      if (existing) return sameConversation(existing, scope, input);
      const selection = { paperIds: input.paperIds ?? [], presentationIds: input.presentationIds ?? [] };
      const [papers, presentations] = await Promise.all([selectedPapers(tx, scope.teamId, selection.paperIds), selectedPresentations(tx, scope.teamId, selection.presentationIds)]);
      const row = await tx.researchConversation.create({ data: { id: input.requestId, ...owner(scope), title: input.title ?? papers[0]?.title.slice(0, 120) ?? presentations[0]?.title.slice(0, 120) ?? "새 대화", paperIds: storeSelection(selection) } });
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
  const selection = readSelection(row.paperIds);
  const [papers, presentations, turns] = await Promise.all([
    selectedPapers(prisma, scope.teamId, selection.paperIds, { allowMissing: true }),
    selectedPresentations(prisma, scope.teamId, selection.presentationIds, { allowMissing: true }),
    prisma.localAgentJob.findMany({ where: { conversationId: id, purpose: "chat", ...owner(scope) }, orderBy: { conversationTurn: "desc" }, take: 51 }),
  ]);
  return { conversation: { ...conversationView(row), paperIds: papers.map(paper => paper.id), presentationIds: presentations.map(item => item.id) }, papers: papers.map(sourceOption), presentations: presentations.map(presentationOption),
    turns: turns.slice(0, 50).reverse().map(turn => turnView(turn, scope)), hasEarlierTurns: turns.length > 50 };
}
function sameTurn(row: LocalAgentJob, scope: LocalAgentScope, id: string, input: ResearchChatTurnInput): ResearchChatTurn {
  if (row.conversationId !== id || row.purpose !== "chat" || row.deviceId !== input.deviceId || row.provider !== input.provider || row.model !== input.model || row.prompt !== input.prompt) reused();
  if (input.effort !== undefined && input.effort !== effortFromContext(row.context)) reused();
  const materials = materialsFromContext(row.context);
  if ((input.paperIds !== undefined && JSON.stringify(materials.filter(item => item.kind === "paper").map(item => item.id)) !== JSON.stringify(input.paperIds)) ||
      (input.presentationIds !== undefined && JSON.stringify(materials.filter(item => item.kind === "presentation").map(item => item.id)) !== JSON.stringify(input.presentationIds))) reused();
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
      const previous = readSelection(row.paperIds);
      const selection = { paperIds: input.paperIds ?? previous.paperIds, presentationIds: input.presentationIds ?? previous.presentationIds };
      if (selection.paperIds.length + selection.presentationIds.length > 10) throw new HttpError(400, "BAD_REQUEST", "한 번에 자료 10개까지 첨부할 수 있어요.");
      const [papers, presentations, recent, latest] = await Promise.all([
        selectedPapers(tx, scope.teamId, selection.paperIds),
        selectedPresentations(tx, scope.teamId, selection.presentationIds),
        tx.localAgentJob.findMany({ where: { conversationId: id, purpose: "chat", status: "completed" }, orderBy: { conversationTurn: "desc" }, take: 9 }),
        tx.localAgentJob.findFirst({ where: { conversationId: id }, orderBy: { conversationTurn: "desc" }, select: { conversationTurn: true } }),
      ]);
      const preparing = papers.some(paper => !paper.sourceText) || presentations.some(item => item.assets.length > 0);
      // Empty numbered pages are an internal placeholder that is never claimable by a CLI.
      const { context: readyContext } = buildChatContext(preparing ? [] : papers, recent, presentations, input.effort ? { effort: input.effort } : undefined);
      const context = preparing ? JSON.stringify({ ...JSON.parse(readyContext), papers: papers.map(paper => ({ id: paper.id, title: paper.title.slice(0, 500), pages: [] })), preparing: true }) : readyContext;
      const nextTurn = (latest?.conversationTurn ?? 0) + 1;
      const execution = { deviceId: input.deviceId, provider: input.provider, model: input.model, prompt: input.prompt, requestId: input.requestId };
      const accepted = await createPreparedJob(scope, { ...execution, paperId: papers[0]?.id ?? "" }, context, { purpose: "chat", conversationId: id, conversationTurn: nextTurn, transaction: tx, initialStatus: preparing ? "preparing" : "queued", ...(input.effort ? { effort: input.effort } : {}) });
      await tx.researchConversation.update({ where: { id }, data: { paperIds: storeSelection(selection, initialSelection(row.paperIds)) } });
      if (preparing) {
        try { await inngest.send({ id: `research-chat-${accepted.id}`, name: "research-chat/prepare", data: { jobId: accepted.id } }); }
        catch { throw new HttpError(503, "QUEUE_UNAVAILABLE", "자료 준비를 시작하지 못했어요. 잠시 후 다시 보내주세요."); }
      }
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
