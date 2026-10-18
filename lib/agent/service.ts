import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type AgentTask } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { inngest } from "@/lib/inngest";
import { assertAgentCapability, assertJobTarget, createPreparedJob, type LocalAgentScope } from "@/lib/local-agent/service";
import { assertGrantUsable } from "@/lib/local-agent/security";
import { parsePaperSource, sourceFailureMessage } from "@/lib/local-ai/source";
import { preparePaperSource } from "@/lib/local-ai/service";
import { createSectionNote } from "@/lib/section-notes";
import { createPresentationRecord } from "@/lib/presentation-writes";
import { assertGeneratedPresentationStorage } from "@/lib/storage";
import type { AgentObservation, AgentTaskInput, AgentTaskView } from "@/types/agent-task";
import type { LocalAgentEffort, LocalAgentProvider } from "@/types/local-agent";
import { z } from "zod";
import { ExportRequestSchema, ExportPayloadSchema, type ExportRequest } from "@/lib/seminar/export-contract";
import { attachSeminarExport, getSeminarExport, latestSeminarExport, seminarDraftHash, verifySeminarAttachments } from "@/lib/seminar/exports";
import { SeminarActionSchema, type SeminarAction, type SeminarFigure } from "@/lib/seminar/contract";
import { acceptSeminarDecision, createSeminarWorkspace, guidedSeminarInstructions, queueSeminarAction, readSeminarWorkspace, seminarContext, validateSeminarMedia } from "@/lib/seminar/workflow";
import { agentInstructions, seminarInstructions, DraftSchema, SeminarDraftSchema, SeminarSaveSchema, parseDecision, sourceRevision, TaskControlSchema, TaskCreateSchema, TaskSaveSchema, validateDraft, validateSeminarDraft } from "./contract";

type Database = Prisma.TransactionClient;
const active = ["queued", "running"];
const cancellable = [...active, "waiting_input", "waiting_review", "waiting_connection"];
const owner = (scope: Pick<LocalAgentScope, "teamId" | "memberId">) => ({ teamId: scope.teamId, memberId: scope.memberId });
const scopeOf = (task: AgentTask): LocalAgentScope => ({ ...owner(task), sessionKey: task.sessionKey, sessionExpiresAt: task.sessionExpiresAt });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const conflict = () => new HttpError(409, "TASK_CHANGED", "작업 내용이 바뀌었어요. 최신 내용을 확인해주세요.");
const missing = () => new HttpError(404, "NOT_FOUND", "현재 팀에서 이 작업을 찾을 수 없어요.");
const feature = () => { if (process.env.AGENT_TASKS_ENABLED !== "1") throw new HttpError(503, "AGENT_UNAVAILABLE", "논문 작업 기능을 준비하고 있어요. 자유 대화는 계속 사용할 수 있어요."); };

async function membership(db: Database, scope: Pick<LocalAgentScope, "teamId" | "memberId">, lock = false) {
  const where = owner(scope);
  const row = await db.membership.findUnique({ where: { teamId_memberId: where } });
  if (!row) throw new HttpError(403, "FORBIDDEN", "이 팀의 작업 권한이 없어요.");
  if (lock && !(await db.membership.updateMany({ where: { ...where, role: row.role }, data: { role: row.role } })).count) throw conflict();
}
async function paperIn(db: Database, teamId: string, paperId: string) {
  const paper = await db.paper.findFirst({ where: { id: paperId, teamId } });
  if (!paper) throw new HttpError(404, "NOT_FOUND", "이 팀에서 논문을 찾을 수 없어요.");
  return paper;
}
async function permission(db: Database, task: AgentTask, scope = scopeOf(task)) {
  if (scope.sessionKey !== task.sessionKey || scope.sessionExpiresAt <= new Date()) throw new HttpError(403, "WEB_PERMISSION_EXPIRED", "새 로그인에서는 작업을 다시 연결한 뒤 저장해주세요.");
  // Same lock order as connector admission/revocation: device, membership, grant.
  const deviceLock = await db.localAgentDevice.updateMany({ where: { id: task.deviceId, ...owner(task), revokedAt: null }, data: { revokedAt: null } });
  if (!deviceLock.count) throw new HttpError(403, "PAIRING_REQUIRED", "AI 연결을 다시 확인해주세요.");
  await membership(db, task, true);
  const grant = await db.localAgentGrant.findFirst({ where: { ...owner(task), sessionKey: task.sessionKey, deviceId: task.deviceId } });
  if (!grant) throw new HttpError(403, "PAIRING_REQUIRED", "AI 연결을 다시 확인해주세요.");
  assertGrantUsable(grant);
  if (!(await db.localAgentGrant.updateMany({ where: { id: grant.id, revokedAt: null, leaseExpiresAt: { gt: new Date() } }, data: { revokedAt: null } })).count) throw new HttpError(403, "WEB_PERMISSION_EXPIRED", "AI 연결 권한이 끝났어요. 다시 연결해주세요.");
}
async function lockedTask(db: Database, id: string, scope?: LocalAgentScope) {
  const task = await db.agentTask.findFirst({ where: { id, ...(scope ? owner(scope) : {}) } });
  if (!task) throw missing();
  if (!(await db.agentTask.updateMany({ where: { id, version: task.version }, data: { version: { increment: 0 } } })).count) throw conflict();
  return task;
}
const update = (db: Database, task: AgentTask, data: Prisma.AgentTaskUpdateInput) => db.agentTask.update({ where: { id: task.id }, data: { ...data, version: { increment: 1 } } });
const DraftOutput = z.object({ pages: z.array(z.object({ page: z.number(), text: z.string() })) }).passthrough();

export async function observePaper(scope: LocalAgentScope, paperId: string, db: Database = prisma): Promise<AgentObservation> {
  await membership(db, scope);
  const paper = await paperIn(db, scope.teamId, paperId);
  return { authority: "domain", observedAt: new Date().toISOString(), revision: sourceRevision(paper),
    paper: { id: paper.id, title: paper.title, sourceReady: Boolean(paper.sourceText), analysisStatus: paper.analysisStatus, analysisRequestId: paper.analysisRequestId },
    actions: { analysis: { allowed: false, reason: "논문 분석 화면에서 실제 모델을 선택해 분석을 시작해주세요." }, prepareNote: { allowed: Boolean(paper.sourceText), reason: paper.sourceText ? null : "논문 원문 준비가 필요해요." } } };
}

async function view(task: AgentTask, scope: LocalAgentScope, db: Database = prisma): Promise<AgentTaskView> {
  const paper = await paperIn(db, scope.teamId, task.paperId);
  const operations = (await db.agentOperation.findMany({ where: { taskId: task.id }, select: { id: true, revision: true, tool: true, status: true, updatedAt: true }, orderBy: { createdAt: "desc" }, take: 60 })).reverse();
  const saved = await db.agentOperation.findFirst({ where: { taskId: task.id, kind: "save", status: "completed" }, orderBy: { createdAt: "desc" } });
  const Saved = z.object({ noteId: z.string(), title: z.string(), body: z.string(), sectionId: z.string(), lens: z.string() });
  const savedValue = Saved.safeParse(saved?.output);
  let savedNote: AgentTaskView["savedNote"] = null;
  if (savedValue.success) {
    const expected = savedValue.data;
    // A fresh authoritative read; a write response is never verification evidence.
    const note = await db.sectionNote.findFirst({ where: { id: expected.noteId, paperId: task.paperId, paper: { teamId: scope.teamId } } });
    const verified = Boolean(note && note.authorId === task.memberId && note.title === expected.title && note.body === expected.body && note.sectionId === expected.sectionId && note.lens === expected.lens);
    savedNote = { id: expected.noteId, href: `/papers/${encodeURIComponent(task.paperId)}#section-${expected.sectionId}`, verified };
  }
  const parsedDraft = DraftSchema.safeParse(task.draft);
  const workspace = readSeminarWorkspace(task.draft);
  const parsedSeminar = SeminarDraftSchema.safeParse(workspace?.deck ?? task.draft);
  const draft = task.kind === "note" && parsedDraft.success ? parsedDraft.data : null;
  const seminarDraft = task.kind === "seminar" && parsedSeminar.success ? parsedSeminar.data : null;
  let savedPresentation: AgentTaskView["savedPresentation"] = null;
  const SavedSeminar = z.object({ presentationId: z.string(), seminar: SeminarDraftSchema });
  const savedSeminar = SavedSeminar.safeParse(saved?.output);
  if (savedSeminar.success) {
    const expected = savedSeminar.data.seminar;
    const actual = await db.presentation.findFirst({ where: { id: savedSeminar.data.presentationId, teamId: scope.teamId } });
    let verified = Boolean(actual && actual.presenterId === task.memberId && actual.sourcePaperId === task.paperId && actual.title === expected.title && actual.summary === expected.summary && actual.duration === `${expected.durationMinutes}분` && actual.slideCount === expected.slides.length && isDeepStrictEqual(actual.slides, expected.slides) && isDeepStrictEqual(actual.keypoints, expected.keypoints));
    const reviewed = SeminarSaveSchema.safeParse(saved?.input);
    if (verified && reviewed.success && reviewed.data.artifactJobId) verified = await verifySeminarAttachments(db,task,savedSeminar.data.presentationId,reviewed.data.artifactJobId,expected);
    else if (workspace) verified = false;
    savedPresentation = { id: savedSeminar.data.presentationId, href: `/presentations/${encodeURIComponent(savedSeminar.data.presentationId)}`, verified };
  }
  const sameSession = task.sessionKey === scope.sessionKey;
  const grant = sameSession ? await db.localAgentGrant.findFirst({ where: { ...owner(task), sessionKey: task.sessionKey, deviceId: task.deviceId, revokedAt: null, leaseExpiresAt: { gt: new Date() }, device: { revokedAt: null } } }) : null;
  const currentSource = task.sourceRevision === sourceRevision(paper);
  const artifact = task.kind === "seminar" ? await latestSeminarExport(db,task.id) : null;
  const labels: Record<string, string> = { "workspace.observe": "논문 상태 확인", "paper.read": "원문 읽기", "paper.read_analysis": "기존 분석 확인", "notes.list": "팀 노트 확인", "model.decide": "다음 작업 준비", "notes.save_reviewed": "검토한 노트 저장", "seminar.save_reviewed": "검토한 세미나 등록" };
  return { id: task.id, conversationId: task.conversationId, version: task.version, revision: task.revision, goal: task.goal,
    status: task.status as AgentTaskView["status"], phase: task.phase, paper: { id: paper.id, title: paper.title }, kind: task.kind as "note" | "seminar", draft, seminarDraft, workspace, export: artifact, error: task.error, savedNote, savedPresentation,
    goalVerified: task.status === "completed" && Boolean(draft || seminarDraft) && (task.completion === "draft" || (task.kind === "seminar" ? savedPresentation?.verified === true : savedNote?.verified === true)),
    requiresReconnect: !saved && (!sameSession || !grant),
    sourceChanged: Boolean(task.sourceRevision && !currentSource),
    canCancel: sameSession && cancellable.includes(task.status),
    canSave: Boolean((draft || seminarDraft) && !saved && currentSource && grant && (!workspace || (artifact?.status === "done" && artifact.current)) && ["completed", "waiting_review"].includes(task.status)),
    canResume: !saved && ["waiting_connection", "waiting_input", "failed", "cancelled", "completed", "waiting_review"].includes(task.status),
    decisionCount: task.decisionCount, toolCount: task.toolCount, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    activity: operations.filter(op => op.revision === task.revision).slice(-12).map(op => ({ id: op.id, label: labels[op.tool] ?? "작업 확인", status: op.status, at: op.updatedAt.toISOString() })) };
}
export async function getTask(scope: LocalAgentScope, id: string): Promise<AgentTaskView> {
  await membership(prisma, scope);
  const task = await prisma.agentTask.findFirst({ where: { id, ...owner(scope) } });
  if (!task) throw missing();
  return view(task, scope);
}
export async function listTasks(scope: LocalAgentScope, conversationId?: string): Promise<AgentTaskView[]> {
  await membership(prisma, scope);
  const tasks = await prisma.agentTask.findMany({ where: { ...owner(scope), conversationId: conversationId ?? null }, orderBy: { updatedAt: "desc" }, take: 10 });
  const papers = new Set((await prisma.paper.findMany({ where: { teamId: scope.teamId, id: { in: tasks.map(task => task.paperId) } }, select: { id: true } })).map(paper => paper.id));
  return Promise.all(tasks.filter(task => papers.has(task.paperId)).map(task => view(task, scope)));
}
async function dispatch(task: AgentTask) {
  if (!active.includes(task.status)) return;
  try { await inngest.send({ id: `agent-${task.id}-r${task.revision}-v${task.version}`, name: "agent-task/run", data: { taskId: task.id, revision: task.revision } }); }
  catch { throw new HttpError(503, "QUEUE_UNAVAILABLE", "작업 요청은 보관했어요. 같은 내용으로 다시 눌러 실행을 이어가주세요."); }
}
export async function createTask(scope: LocalAgentScope, candidate: AgentTaskInput): Promise<AgentTaskView> {
  feature(); const input = TaskCreateSchema.parse(candidate);
  await membership(prisma, scope);
  await paperIn(prisma, scope.teamId, input.paperId);
  await assertJobTarget(scope, input);
  await assertAgentCapability(prisma, input.deviceId, input.provider);
  if (input.conversationId && !await prisma.researchConversation.findFirst({ where: { id: input.conversationId, ...owner(scope) } })) throw missing();
  let task: AgentTask;
  try {
    task = await prisma.$transaction(async tx => {
      const existing = await tx.agentTask.findUnique({ where: { teamId_memberId_requestId: { ...owner(scope), requestId: input.requestId } } });
      if (existing) {
        if (Boolean(readSeminarWorkspace(existing.draft)) !== Boolean(input.workflow) || existing.goal !== input.goal || existing.paperId !== input.paperId || existing.kind !== (input.kind ?? "note") || existing.deviceId !== input.deviceId || existing.provider !== input.provider || existing.model !== input.model || existing.effort !== (input.effort ?? "") || existing.completion !== (input.completion ?? "draft") || existing.conversationId !== (input.conversationId ?? null) || existing.sessionKey !== scope.sessionKey) throw new HttpError(409, "REQUEST_ID_REUSED", "내용이 달라졌어요. 새 작업으로 요청해주세요.");
        return existing;
      }
      const recent = await tx.agentTask.count({ where: { ...owner(scope), createdAt: { gt: new Date(Date.now() - 60_000) } } });
      if (recent >= 10) throw new HttpError(429, "TOO_MANY_TASKS", "요청이 많아요. 잠시 뒤 다시 시작해주세요.");
      return tx.agentTask.create({ data: { ...owner(scope), requestId: input.requestId, sessionKey: scope.sessionKey, sessionExpiresAt: scope.sessionExpiresAt,
        deviceId: input.deviceId, provider: input.provider, model: input.model, effort: input.effort ?? "", paperId: input.paperId, kind: input.kind ?? "note", goal: input.goal, conversationId: input.conversationId, completion: input.completion ?? "draft", ...(input.workflow ? { draft: json(createSeminarWorkspace(input.goal)) } : {}) } });
    });
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") return createTask(scope, input);
    throw cause;
  }
  await dispatch(task);
  return view(task, scope);
}

async function stopJobs(db: Database, task: AgentTask) {
  if (task.activeJobId) await db.localAgentJob.updateMany({ where: { id: task.activeJobId, ...owner(task), status: { in: ["preparing", "queued", "running"] } }, data: { status: "cancelled", error: "작업 조건이 바뀌었거나 중지됐어요.", version: { increment: 1 } } });
}
export async function controlTask(scope: LocalAgentScope, id: string, candidate: z.infer<typeof TaskControlSchema>): Promise<AgentTaskView> {
  const input = TaskControlSchema.parse(candidate); await membership(prisma, scope);
  if (input.action !== "cancel") feature();
  const task = await prisma.$transaction(async tx => {
    const current = await lockedTask(tx, id, scope);
    if (current.version !== input.expectedVersion) throw conflict();
    if (await tx.agentOperation.findFirst({ where: { taskId: id, kind: "save", status: "completed" } })) throw conflict();
    if (input.action === "cancel") {
      if (current.sessionKey !== scope.sessionKey || !cancellable.includes(current.status)) throw new HttpError(403, "FORBIDDEN", "현재 세션에서 실행 중인 작업만 중지할 수 있어요.");
      await stopJobs(tx, current);
      return update(tx, current, { status: "cancelled", phase: "cancelled", activeJobId: null, error: "작업을 중지했어요." });
    }
    const target = { deviceId: input.deviceId ?? current.deviceId, provider: input.provider ?? current.provider as LocalAgentProvider, model: input.model ?? current.model, effort: input.effort ?? (input.deviceId || input.provider || input.model ? "" : current.effort) };
    const next = { ...current, ...target, sessionKey: scope.sessionKey, sessionExpiresAt: scope.sessionExpiresAt };
    await permission(tx, next, scope);
    await assertAgentCapability(tx, target.deviceId, target.provider);
    await stopJobs(tx, current);
    if (input.action === "steer" && !input.goal) throw new HttpError(400, "BAD_REQUEST", "바꿀 작업 내용을 입력해주세요.");
    const paper = await paperIn(tx, scope.teamId, current.paperId);
    let workspace = readSeminarWorkspace(current.draft);
    if (workspace) {
      const keep = input.action === "resume" && current.sourceRevision === sourceRevision(paper);
      const nextWorkspace = keep ? workspace : createSeminarWorkspace(input.goal ?? current.goal);
      return update(tx, current, { ...target, sessionKey: scope.sessionKey, sessionExpiresAt: scope.sessionExpiresAt, goal: input.goal ?? current.goal,
        status: nextWorkspace.pending ? "queued" : nextWorkspace.deck ? "waiting_review" : "waiting_input", phase: `seminar_${nextWorkspace.stage}`, draft: json(nextWorkspace), error: null, activeJobId: null,
        ...(keep && !nextWorkspace.pending ? {} : { revision: { increment: 1 }, decisionCount: 0, toolCount: 0, repairCount: 0, runStartedAt: new Date() }), ...(keep ? {} : { sourceRevision: null }) });
    }
    const keepDraft = input.action === "resume" && current.draft && current.sourceRevision === sourceRevision(paper);
    return update(tx, current, { ...target, sessionKey: scope.sessionKey, sessionExpiresAt: scope.sessionExpiresAt, goal: input.goal ?? current.goal,
      status: keepDraft ? current.completion === "draft" ? "completed" : "waiting_review" : "queued", phase: keepDraft ? "draft_ready" : "queued", error: null, activeJobId: null,
      ...(keepDraft ? {} : { revision: { increment: 1 }, decisionCount: 0, toolCount: 0, repairCount: 0, draft: Prisma.JsonNull, sourceRevision: null, runStartedAt: new Date() }) });
  });
  await dispatch(task); return view(task, scope);
}

/** A user turn resumes one bounded run; it never grants publication or extends a lease. */
export async function continueSeminarTask(scope: LocalAgentScope, id: string, candidate: SeminarAction): Promise<AgentTaskView> {
  feature(); const input = SeminarActionSchema.parse(candidate); await membership(prisma, scope);
  const task = await prisma.$transaction(async tx => {
    const current = await lockedTask(tx, id, scope);
    const target = { deviceId: input.deviceId ?? current.deviceId, provider: input.provider ?? current.provider as LocalAgentProvider, model: input.model ?? current.model, effort: input.effort ?? (input.deviceId || input.provider || input.model ? "" : current.effort) };
    if (target.provider === "codex" && target.effort === "max") throw new HttpError(400, "BAD_REQUEST", "현재 모델에서 지원하는 생각 깊이를 선택해주세요.");
    await permission(tx, { ...current, ...target, sessionKey: scope.sessionKey, sessionExpiresAt: scope.sessionExpiresAt }, scope);
    await assertAgentCapability(tx, target.deviceId, target.provider);
    const previous = await tx.agentOperation.findFirst({ where: { taskId: id, kind: "input", key: `seminar-input-${input.requestId}` } });
    if (previous) { if (!isDeepStrictEqual(previous.input, json(input))) throw conflict(); return current; }
    if (current.version !== input.expectedVersion || active.includes(current.status) || current.status === "cancelled" || await tx.agentOperation.findFirst({ where: { taskId: id, kind: "save", status: "completed" } })) throw conflict();
    let workspace = readSeminarWorkspace(current.draft);
    if (!workspace || current.kind !== "seminar") throw missing();
    const paper = await paperIn(tx, scope.teamId, current.paperId);
    if (current.sourceRevision !== sourceRevision(paper)) throw new HttpError(409, "SOURCE_CHANGED", "원문이나 분석이 바뀌었어요. 최신 자료로 PT 기획을 다시 시작해주세요.");
    if (input.reviewedDraft) {
      if (!workspace.deck || input.action !== "revise") throw conflict();
      const reads = await tx.agentOperation.findMany({ where: { taskId: id, revision: current.revision, tool: "paper.read", status: "completed" } });
      const pages = reads.flatMap(op => { const parsed = DraftOutput.safeParse(op.output); return parsed.success ? parsed.data.pages : []; });
      workspace = { ...workspace, deck: validateSeminarMedia(input.reviewedDraft, pages, await seminarFigures(tx, current)) };
    }
    let next;
    try { next = queueSeminarAction(workspace, { action: input.action, ...(input.text ? { text: input.text } : {}), ...(input.directionId ? { directionId: input.directionId } : {}) }); }
    catch (cause) { throw new HttpError(409, "TASK_CHANGED", cause instanceof Error ? cause.message : "현재 PT 상태를 확인해주세요."); }
    await tx.agentOperation.create({ data: { id: randomUUID(), taskId: id, revision: current.revision + 1, key: `seminar-input-${input.requestId}`, kind: "input", tool: "seminar.dialogue", status: "completed", input: json(input) } });
    return update(tx, current, { ...target, sessionKey: scope.sessionKey, sessionExpiresAt: scope.sessionExpiresAt, status: "queued", phase: `seminar_${next.pending}`, draft: json(next), error: null, activeJobId: null, revision: { increment: 1 }, decisionCount: 0, toolCount: 0, repairCount: 0, runStartedAt: new Date() });
  });
  await dispatch(task); return view(task, scope);
}

export async function saveTaskNote(scope: LocalAgentScope, id: string, candidate: z.infer<typeof TaskSaveSchema>): Promise<AgentTaskView> {
  feature(); const input = TaskSaveSchema.parse(candidate); await membership(prisma, scope);
  await prisma.$transaction(async tx => {
    const task = await lockedTask(tx, id, scope);
    await permission(tx, task, scope);
    if (task.kind !== "note") throw new HttpError(400, "BAD_REQUEST", "이 작업의 세미나 초안을 확인해주세요.");
    const previous = await tx.agentOperation.findFirst({ where: { taskId: id, kind: "save", status: "completed" } });
    if (previous) {
      const prior = TaskSaveSchema.safeParse(previous.input);
      if (!prior.success || JSON.stringify(prior.data) !== JSON.stringify(input)) throw conflict();
      return;
    }
    if (task.version !== input.expectedVersion || !["completed", "waiting_review"].includes(task.status)) throw conflict();
    const draft = DraftSchema.parse(task.draft);
    const paper = await paperIn(tx, scope.teamId, task.paperId);
    if (task.sourceRevision !== sourceRevision(paper)) throw new HttpError(409, "SOURCE_CHANGED", "원문이나 분석이 바뀌었어요. 최신 자료로 초안을 다시 준비해주세요.");
    const lockedSource = await tx.paper.updateMany({ where: { id: paper.id, teamId: scope.teamId, sourceDigest: paper.sourceDigest, sourceText: paper.sourceText, analysisRequestId: paper.analysisRequestId }, data: { analysisRequestId: paper.analysisRequestId } });
    if (!lockedSource.count) throw new HttpError(409, "SOURCE_CHANGED", "원문이 바뀌었어요. 초안을 다시 준비해주세요.");
    const note = await createSectionNote(tx, scope, { paperId: paper.id, sectionId: draft.sectionId, lens: draft.lens, title: input.title, body: input.body });
    await tx.agentOperation.create({ data: { id: randomUUID(), taskId: id, revision: task.revision, key: "reviewed-save", kind: "save", tool: "notes.save_reviewed", status: "completed", input: json(input), output: json({ noteId: note.id, title: note.title, body: note.body, sectionId: note.sectionId, lens: note.lens, actorId: scope.memberId, sourceRevision: task.sourceRevision, reviewedAt: new Date().toISOString() }) } });
    await update(tx, task, { status: "completed", phase: "saved", draft: json({ ...draft, title: input.title, body: input.body }), error: null });
  });
  // Post-commit, separate read verifies the actual stored object.
  return getTask(scope, id);
}

export async function saveTaskSeminar(scope: LocalAgentScope, id: string, candidate: z.infer<typeof SeminarSaveSchema>): Promise<AgentTaskView> {
  feature(); const input = SeminarSaveSchema.parse(candidate); await membership(prisma, scope);
  await prisma.$transaction(async tx => {
    const task = await lockedTask(tx, id, scope);
    await permission(tx, task, scope);
    if (task.kind !== "seminar") throw new HttpError(400, "BAD_REQUEST", "이 작업은 노트 초안이에요.");
    const previous = await tx.agentOperation.findFirst({ where: { taskId: id, kind: "save", status: "completed" } });
    if (previous) {
      const prior = SeminarSaveSchema.safeParse(previous.input);
      if (!prior.success || !isDeepStrictEqual(prior.data, input)) throw conflict();
      return;
    }
    const workspace = readSeminarWorkspace(task.draft);
    if (task.version !== input.expectedVersion || !["completed", "waiting_review"].includes(task.status) || !SeminarDraftSchema.safeParse(workspace?.deck ?? task.draft).success) throw conflict();
    if (workspace && !input.artifactJobId) throw new HttpError(409,"EXPORT_REVIEW_REQUIRED","HTML/PDF를 먼저 준비하고 출력 내용을 확인한 뒤 세미나를 등록해주세요.");
    const paper = await paperIn(tx, scope.teamId, task.paperId);
    if (task.sourceRevision !== sourceRevision(paper)) throw new HttpError(409, "SOURCE_CHANGED", "원문이나 분석이 바뀌었어요. 최신 자료로 세미나를 다시 준비해주세요.");
    if (!(await tx.paper.updateMany({ where: { id: paper.id, teamId: scope.teamId, sourceDigest: paper.sourceDigest, sourceText: paper.sourceText, analysisRequestId: paper.analysisRequestId }, data: { analysisRequestId: paper.analysisRequestId } })).count) throw conflict();
    const reads = await tx.agentOperation.findMany({ where: { taskId: id, revision: task.revision, tool: "paper.read", status: "completed" } });
    const pages = reads.flatMap(op => { const result = DraftOutput.safeParse(op.output); return result.success ? result.data.pages : []; });
    const seminar = validateSeminarDraft(input.seminar, pages);
    validateSeminarMedia(seminar, pages, await seminarFigures(tx, task), Boolean(workspace));
    const presentation = await createPresentationRecord(tx, scope, { title: seminar.title, sourcePaperId: paper.id, duration: `${seminar.durationMinutes}분`, slideCount: seminar.slides.length, summary: seminar.summary, keypoints: seminar.keypoints, slides: seminar.slides });
    if (input.artifactJobId) await attachSeminarExport(tx, scope, id, presentation.id, input.artifactJobId, seminar);
    await tx.agentOperation.create({ data: { id: randomUUID(), taskId: id, revision: task.revision, key: "reviewed-save", kind: "save", tool: "seminar.save_reviewed", status: "completed", input: json(input), output: json({ presentationId: presentation.id, seminar, actorId: scope.memberId, sourceRevision: task.sourceRevision, reviewedAt: new Date().toISOString() }) } });
    await update(tx, task, { status: "completed", phase: "presentation_saved", draft: json(workspace ? { ...workspace, deck: seminar } : seminar), error: null });
  });
  return getTask(scope, id);
}

/** Freeze the explicitly reviewed snapshot and enqueue; rendering is exclusively durable-worker work. */
export async function queueSeminarExport(scope: LocalAgentScope, id: string, candidate: ExportRequest) {
  feature();
  const input = ExportRequestSchema.parse(candidate), draftHash = seminarDraftHash(input.seminar);
  await prisma.$transaction(async tx => {
    const task = await lockedTask(tx,id,scope);
    const grant = await tx.localAgentGrant.findFirst({ where: { ...owner(scope),sessionKey: scope.sessionKey,revokedAt: null,leaseExpiresAt: { gt: new Date() },device: { revokedAt: null } },orderBy: { leaseExpiresAt: "desc" } });
    if (!grant) throw new HttpError(403,"WEB_PERMISSION_EXPIRED","AI 연결을 확인한 뒤 발표 파일을 다시 준비해주세요.");
    // This new deterministic export uses the current web grant, never a historical task session.
    await permission(tx,{ ...task,deviceId: grant.deviceId,sessionKey: scope.sessionKey,sessionExpiresAt: scope.sessionExpiresAt },scope);
    if (task.kind !== "seminar") throw missing();
    assertGeneratedPresentationStorage();
    const old = await tx.job.findUnique({ where: { id: input.requestId } });
    if (old) {
      const parsed = ExportPayloadSchema.safeParse(old.payload);
      if (old.type !== "seminar_export" || !parsed.success || parsed.data.taskId !== id || parsed.data.memberId !== scope.memberId || parsed.data.teamId !== scope.teamId || parsed.data.draftHash !== draftHash || parsed.data.expectedVersion !== input.expectedVersion) throw conflict();
      return;
    }
    const workspace = readSeminarWorkspace(task.draft), existing = SeminarDraftSchema.safeParse(workspace?.deck ?? task.draft);
    if (task.version !== input.expectedVersion || !["waiting_review","completed"].includes(task.status) || !existing.success) throw conflict();
    const paper = await paperIn(tx,scope.teamId,task.paperId);
    if (sourceRevision(paper) !== task.sourceRevision) throw new HttpError(409,"SOURCE_CHANGED","원문이 바뀌었어요. 최신 자료로 발표를 다시 준비해주세요.");
    const saved = await tx.agentOperation.findFirst({ where: { taskId: id, kind: "save", status: "completed" } });
    if (saved && seminarDraftHash(existing.data) !== draftHash) throw conflict();
    const reads = await tx.agentOperation.findMany({ where: { taskId: id, revision: task.revision, tool: "paper.read", status: "completed" } });
    const pages = reads.flatMap(op => { const parsed = DraftOutput.safeParse(op.output); return parsed.success ? parsed.data.pages : []; });
    const seminar = validateSeminarDraft(input.seminar,pages);
    validateSeminarMedia(seminar,pages,await seminarFigures(tx,task),Boolean(workspace));
    await tx.job.create({ data: { id: input.requestId, type: "seminar_export", payload: json({ version: 1, taskId: id, teamId: scope.teamId, memberId: scope.memberId, paperId: task.paperId, sourceRevision: task.sourceRevision, draftHash, draft: seminar, expectedVersion: input.expectedVersion }) } });
    await tx.agentOperation.create({ data: { id: randomUUID(), taskId: id, revision: task.revision, key: `export-${input.requestId}`, kind: "export", tool: "seminar.export", status: "completed", input: json({ draftHash }), output: json({ jobId: input.requestId }) } });
    await update(tx,task,{ draft: json(workspace ? { ...workspace, deck: seminar } : seminar) });
  });
  const artifact = await getSeminarExport(scope,id,input.requestId);
  if (artifact.status === "queued") {
    try { await inngest.send({ id: `seminar-export-${input.requestId}`, name: "seminar/export", data: { jobId: input.requestId } }); }
    catch { throw new HttpError(503,"QUEUE_UNAVAILABLE","출력 요청은 보관했어요. 같은 내용으로 다시 눌러 준비를 이어가주세요."); }
  }
  return { task: await getTask(scope,id), export: artifact };
}

async function seminarFigures(db: Database, task: Pick<AgentTask, "paperId" | "teamId">): Promise<SeminarFigure[]> {
  return (await db.figure.findMany({ where: { paperId: task.paperId, paper: { teamId: task.teamId } }, select: { id: true, title: true, caption: true, sourcePage: true, imageUrl: true }, take: 20 })).map(figure => ({ id: figure.id, title: figure.title.slice(0, 160), caption: figure.caption.slice(0, 600), sourcePage: figure.sourcePage, available: Boolean(figure.imageUrl) }));
}

async function readTool(db: Database, task: AgentTask, decision: Extract<ReturnType<typeof parseDecision>, { action: "read" }>) {
  if (decision.tool !== "paper.read" && decision.input.pages) throw new Error("Pages only apply to paper.read");
  const paper = await paperIn(db, task.teamId, task.paperId);
  switch (decision.tool) {
    case "workspace.observe": return observePaper(scopeOf(task), task.paperId, db);
    case "paper.read": {
      const all = parsePaperSource(paper.sourceText ?? "");
      const selected = decision.input.pages ? all.filter(page => decision.input.pages!.includes(page.page)) : all;
      if (!selected.length) throw new Error("No requested pages");
      let limit = 120_000;
      const sourceBudget = readSeminarWorkspace(task.draft) ? 80_000 : 130_000;
      while (JSON.stringify(selected.map(page => ({ ...page, text: page.text.slice(0, limit) }))).length > sourceBudget) limit = Math.floor(limit / 2);
      return { pages: selected.map(page => ({ ...page, text: page.text.slice(0, limit) })), truncated: selected.some(page => page.text.length > limit), sourceRevision: sourceRevision(paper) };
    }
    case "paper.read_analysis": {
      const analyses = await db.analysis.findMany({ where: { paperId: paper.id }, select: { lens: true, payload: true } });
      const figures = await seminarFigures(db, task);
      const text = JSON.stringify({ analyses, figures });
      return { text: text.slice(0, 25_000), figures, truncated: text.length > 25_000, figureInterpretation: "text_caption_inference", repositoriesVisited: false };
    }
    case "notes.list": return { notes: (await db.sectionNote.findMany({ where: { paperId: paper.id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, sectionId: true, lens: true, title: true, body: true } })).map(note => ({ ...note, title: note.title.slice(0, 180), body: note.body.slice(0, 1000) })), truncated: true };
  }
}

/** Validate source work without exposing session credentials in durable step results. */
export async function agentSourceTarget(id: string, revision: number) {
  const task = await prisma.agentTask.findUnique({ where: { id } });
  if (!task || task.revision !== revision || !active.includes(task.status) || task.activeJobId || process.env.AGENT_TASKS_ENABLED !== "1") return null;
  await membership(prisma, task);
  await assertJobTarget(scopeOf(task), { deviceId: task.deviceId, provider: task.provider as LocalAgentProvider, model: task.model });
  await paperIn(prisma, task.teamId, task.paperId);
  return { kind: "paper" as const, id: task.paperId, teamId: task.teamId };
}

export async function failAgentSource(id: string, revision: number, cause: unknown) {
  const connection = cause instanceof HttpError && [401, 403, 409].includes(cause.status);
  await prisma.agentTask.updateMany({ where: { id, revision, status: { in: active } },
    data: { status: connection ? "waiting_connection" : "failed", phase: connection ? "connection" : "source_failed",
      error: connection ? "AI 연결을 확인하고 작업을 다시 이어가주세요." : sourceFailureMessage(cause), version: { increment: 1 } } });
}

/** One short durable tick. Never waits on CLI inference and never shares generated content. */
export async function advanceTask(id: string, expectedRevision?: number): Promise<AgentTaskView | null> {
  let initial = await prisma.agentTask.findUnique({ where: { id } });
  if (!initial || (expectedRevision !== undefined && initial.revision !== expectedRevision)) return null;
  if (active.includes(initial.status) && !initial.activeJobId && process.env.AGENT_TASKS_ENABLED === "1") {
    try {
      await membership(prisma, initial);
      await assertJobTarget(scopeOf(initial), { deviceId: initial.deviceId, provider: initial.provider as LocalAgentProvider, model: initial.model });
      const paper = await paperIn(prisma, initial.teamId, initial.paperId);
      if (!paper.sourceText) await preparePaperSource(paper.id);
    } catch (cause) {
      const connection = cause instanceof HttpError && [401, 403, 409].includes(cause.status);
      await prisma.agentTask.updateMany({ where: { id, version: initial.version, status: { in: active } }, data: { status: connection ? "waiting_connection" : "failed", phase: connection ? "connection" : "source_failed", error: connection ? "AI 연결을 확인하고 작업을 다시 이어가주세요." : sourceFailureMessage(cause), version: { increment: 1 } } });
      return getTask(scopeOf(initial), id);
    }
  }
  try {
    initial = await prisma.$transaction(async tx => {
      const task = await lockedTask(tx, id);
      const workspace = readSeminarWorkspace(task.draft);
      if (expectedRevision !== undefined && task.revision !== expectedRevision) return task;
      if (!active.includes(task.status)) return task;
      await membership(tx, task);
      if (process.env.AGENT_TASKS_ENABLED !== "1") return update(tx, task, { status: "waiting_connection", phase: "connection", error: "작업 기능이 잠시 중지됐어요. 저장된 이력은 보관돼요." });
      const paper = await paperIn(tx, task.teamId, task.paperId);
      const revision = sourceRevision(paper);
      if (task.sourceRevision && revision !== task.sourceRevision) {
        await stopJobs(tx, task);
        return update(tx, task, { status: "waiting_input", phase: "source_changed", activeJobId: null, error: "원문이나 분석이 바뀌었어요. 최신 자료로 다시 준비해주세요." });
      }
      const operations = await tx.agentOperation.findMany({ where: { taskId: id, revision: task.revision }, orderBy: { createdAt: "asc" } });
      if (task.activeJobId) {
        const job = await tx.localAgentJob.findFirst({ where: { id: task.activeJobId, ...owner(task), purpose: "agent_step" } });
        const op = operations.find(operation => operation.jobId === task.activeJobId);
        if (job?.status === "completed" && op?.status === "running") {
          try {
            const decision = parseDecision(job.response);
            if (workspace && decision.action !== "read") {
              const pages = operations.filter(operation => operation.tool === "paper.read" && operation.status === "completed").flatMap(operation => { const value = DraftOutput.safeParse(operation.output); return value.success ? value.data.pages : []; });
              const next = acceptSeminarDecision(workspace, decision, pages, await seminarFigures(tx, task));
              await tx.agentOperation.update({ where: { id: op.id }, data: { status: "completed", output: json({ action: decision.action }) } });
              return update(tx, task, { status: next.deck && next.stage === "deck" ? "waiting_review" : "waiting_input", phase: `seminar_${next.stage}`, activeJobId: null, draft: json(next), error: null });
            }
            if (decision.action === "seminar_directions" || decision.action === "seminar_question" || decision.action === "seminar_outline") throw new Error("A guided seminar workspace is required");
            if (decision.action === "draft" || decision.action === "seminar_draft") {
              if ((task.kind === "seminar") !== (decision.action === "seminar_draft")) throw new Error("Wrong artifact kind");
              const pages = operations.filter(operation => operation.tool === "paper.read" && operation.status === "completed").flatMap(operation => { const value = DraftOutput.safeParse(operation.output); return value.success ? value.data.pages : []; });
              const draft = decision.action === "seminar_draft" ? validateSeminarDraft(decision.draft, pages) : validateDraft(decision.draft, pages);
              await tx.agentOperation.update({ where: { id: op.id }, data: { status: "completed", output: json({ action: decision.action }) } });
              return update(tx, task, { status: task.completion === "draft" ? "completed" : "waiting_review", phase: "draft_ready", activeJobId: null, draft: json(draft), error: null });
            }
            if (decision.action === "finish") throw new Error("A draft and actual postconditions are required");
            await permission(tx, task);
            if (decision.action === "ask") {
              await tx.agentOperation.update({ where: { id: op.id }, data: { status: "completed", output: json(decision) } });
              return update(tx, task, { status: "waiting_input", phase: "question", activeJobId: null, error: decision.question });
            }
            if (task.toolCount >= 10) throw new Error("Tool budget exceeded");
            const repeated = operations.filter(operation => operation.kind === "read" && operation.tool === decision.tool && JSON.stringify(operation.input) === JSON.stringify(decision.input));
            if (repeated.length >= 2) throw new Error("No progress");
            const result = await readTool(tx, task, decision);
            await tx.agentOperation.create({ data: { id: randomUUID(), taskId: id, revision: task.revision, key: `read-${task.decisionCount}`, kind: "read", tool: decision.tool, input: json(decision.input), output: json(result), status: "completed" } });
            await tx.agentOperation.update({ where: { id: op.id }, data: { status: "completed", output: json({ action: "read", tool: decision.tool }) } });
            return update(tx, task, { status: "running", phase: "reading", activeJobId: null, toolCount: { increment: 1 }, error: null });
          } catch (cause) {
            if (cause instanceof HttpError && cause.status === 403) throw cause;
            await tx.agentOperation.update({ where: { id: op.id }, data: { status: "failed", output: json({ error: "INVALID_DECISION" }) } });
            return update(tx, task, { activeJobId: null, repairCount: { increment: 1 }, status: task.repairCount >= 1 ? "failed" : "running", phase: "decision_invalid", error: "원문 근거와 작업 형식을 확인하지 못했어요. 작업 조건을 바꿔 다시 준비할 수 있어요." });
          }
        }
        await permission(tx, task);
        if (!job || ["failed", "cancelled"].includes(job.status)) return update(tx, task, { status: "failed", phase: "inference_failed", activeJobId: null, error: job?.error ?? "답변을 완료하지 못했어요. 다시 준비해주세요." });
        if (job.expiresAt <= new Date()) {
          await stopJobs(tx, task);
          return update(tx, task, { status: "failed", phase: "timeout", activeJobId: null, error: "작업 시간이 끝났어요. 다시 준비해주세요." });
        }
        return task;
      }
      await permission(tx, task);
      if (task.decisionCount >= 6 || Date.now() - task.runStartedAt.getTime() > 600_000) return update(tx, task, { status: "failed", phase: "budget", error: "이번 작업의 실행 범위에 도달했어요. 요청을 좁혀 다시 준비해주세요." });
      const recent = new Map<string, unknown>();
      let preparedReads = 0;
      for (const operation of operations) if (operation.kind === "read" && operation.status === "completed") recent.set(operation.tool, operation.output);
      if (workspace && !recent.has("paper.read")) {
        for (const tool of ["paper.read", "paper.read_analysis"] as const) {
          const result = await readTool(tx, task, { version: 1, action: "read", tool, input: {} });
          await tx.agentOperation.create({ data: { id: randomUUID(), taskId: id, revision: task.revision, key: `prepared-${tool}`, kind: "read", tool, input: {}, output: json(result), status: "completed" } });
          recent.set(tool, result);
          preparedReads++;
        }
      }
      const context = JSON.stringify({ version: 1, kind: "agent_task", decisionContract: workspace ? guidedSeminarInstructions : task.kind === "seminar" ? seminarInstructions : agentInstructions, task: { id, kind: task.kind, revision: task.revision, goal: task.goal, completion: task.completion }, ...(workspace ? { workspace: seminarContext(workspace) } : {}), observation: await observePaper(scopeOf(task), paper.id, tx), results: Object.fromEntries(recent), previousDecisionInvalid: task.repairCount > 0, execution: task.effort ? { effort: task.effort } : {} });
      if (context.length > 200_000) return update(tx, task, { status: "failed", phase: "context_limit", error: "읽을 자료가 너무 많아요. 페이지 범위를 좁혀 다시 요청해주세요." });
      const operationId = randomUUID();
      const job = await createPreparedJob(scopeOf(task), { deviceId: task.deviceId, paperId: task.paperId, provider: task.provider as LocalAgentProvider, model: task.model, prompt: task.goal, requestId: operationId }, context, { purpose: "agent_step", transaction: tx, ...(task.effort ? { effort: task.effort as LocalAgentEffort } : {}) });
      await tx.agentOperation.create({ data: { id: operationId, taskId: id, revision: task.revision, key: `model-${task.decisionCount + 1}`, kind: "model", tool: "model.decide", status: "running", input: json({ sourceRevision: revision }), jobId: job.id } });
      return update(tx, task, { status: "running", phase: "thinking", activeJobId: job.id, sourceRevision: revision, decisionCount: { increment: 1 }, ...(preparedReads ? { toolCount: { increment: preparedReads } } : {}) });
    });
  } catch (cause) {
    if (cause instanceof HttpError && cause.code === "TASK_CHANGED") return null;
    const connection = cause instanceof HttpError && [401, 403, 409].includes(cause.status);
    await prisma.agentTask.updateMany({ where: { id, revision: initial.revision, version: initial.version, status: { in: active } }, data: { status: connection ? "waiting_connection" : "failed", phase: connection ? "connection" : "failed", error: connection ? "AI 연결 권한을 다시 확인하고 이어가주세요." : "작업을 완료하지 못했어요. 다시 준비해주세요.", version: { increment: 1 } } });
    const current = await prisma.agentTask.findUnique({ where: { id } });
    return current ? view(current, scopeOf(current)) : null;
  }
  return initial ? view(initial, scopeOf(initial)) : null;
}
