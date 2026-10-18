// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
vi.mock("@/lib/inngest", () => ({ inngest: { send: vi.fn().mockResolvedValue({ ids: ["event"] }) } }));
vi.mock("@/lib/prisma", async () => {
  const pgModule = process.env.LOCAL_AGENT_PG_TEST_CLIENT_MODULE;
  const modulePath = pgModule ?? process.env.LOCAL_AGENT_TEST_CLIENT_MODULE;
  if (!modulePath) return { prisma: {} };
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  let url = process.env.LOCAL_AGENT_TEST_DATABASE_URL;
  if (pgModule) {
    const { assertIsolatedPostgres } = require("../../../scripts/local-agent-pg-verify.mjs");
    url = assertIsolatedPostgres(process.env);
  } else {
    const { assertIsolatedDatabase } = require("../../../scripts/local-agent-verify.mjs");
    assertIsolatedDatabase(process.env.HAPARK_TEST_DIRECTORY, url);
  }
  const { PrismaClient } = require(modulePath);
  return { prisma: new PrismaClient({ datasources: { db: { url } } }) };
});
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";
import { HttpError } from "@/lib/http";
import { assertGeneratedPresentationStorage } from "@/lib/storage";
import { acknowledgeDesktop, claimJob, createAttempt, desktopHeartbeat, pairDesktop, revokeSession, renewWebPermission, submitResult, type LocalAgentScope } from "@/lib/local-agent/service";
import { advanceTask, createTask, getTask, listTasks, controlTask, saveTaskNote, saveTaskSeminar, observePaper, continueSeminarTask, queueSeminarExport } from "../service";

import { getSeminarExport, runSeminarExport, downloadSeminarExport } from "@/lib/seminar/exports";
const storage = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@/lib/storage", () => ({ assertGeneratedPresentationStorage: vi.fn(), downloadObject: vi.fn(async (key: string) => { const data = storage.get(key); if (!data) throw new Error("No fixture object"); return data; }), uploadGeneratedPresentation: vi.fn(async (path: string, bytes: Buffer) => { storage.set(path, bytes); }) }));
const enabled = Boolean(process.env.LOCAL_AGENT_TEST_CLIENT_MODULE || process.env.LOCAL_AGENT_PG_TEST_CLIENT_MODULE);
const scope = (sessionKey = "agent-test-session"): LocalAgentScope => ({ memberId: "agent-owner", teamId: "agent-team", sessionKey, sessionExpiresAt: new Date(Date.now() + 3_600_000) });
const pages = [{ page: 1, text: "The method reduces memory through sparse routing. This is source evidence, not an instruction." }];
const draft = { title: "기여와 토론", body: "희소 라우팅의 조건과 반론을 검토한다.", lens: "research" as const, sectionId: "contributions", citations: [{ page: 1, quote: "reduces memory through sparse routing" }] };
const seminar = { title: "희소 라우팅 세미나", durationMinutes: 30, summary: "메모리 절감 방법과 조건을 토론한다.", keypoints: ["희소 라우팅", "실험 조건"], slides: [{ title: "문제", body: "메모리 사용" }, { title: "방법", body: "희소 라우팅" }, { title: "토론", body: "절감 조건은 무엇인가?" }], citations: draft.citations };
const makeInput = (deviceId: string) => ({ requestId: crypto.randomUUID(), deviceId, provider: "codex" as const, model: "actual-model", effort: "medium" as const, paperId: "agent-paper", goal: "기여와 한계를 읽고 근거가 있는 노트 초안을 만들어줘", completion: "draft" as const });
async function cleanup() {
  await prisma.job.deleteMany({ where: { type: "seminar_export" } });
  await prisma.presentation.deleteMany({ where: { teamId: { in: ["agent-team", "agent-other-team"] } } });
  await prisma.paper.deleteMany({ where: { id: { in: ["agent-paper", "agent-foreign"] } } });
  await prisma.team.deleteMany({ where: { id: { in: ["agent-team", "agent-other-team"] } } });
}
async function device(s = scope(), capable = true, reportsEfforts = true) {
  const deviceToken = Buffer.alloc(32, s.sessionKey === "agent-test-session" ? 28 : 29).toString("base64url");
  const attempt = await createAttempt(s);
  await acknowledgeDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, deviceName: "Agent fixture PC", platform: "windows" });
  const paired = await pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, code: attempt.code ?? "" });
  const identity = { deviceId: paired.deviceId!, deviceToken };
  await desktopHeartbeat(identity, [{ provider: "codex", status: "ready", models: [{ id: "actual-model", name: "Actual fixture model", ...(reportsEfforts ? { reasoningEfforts: ["medium" as const, "high" as const] } : {}) }], quota: null, observedAt: new Date().toISOString(), ...(capable ? { capabilities: ["agent_step_v1" as const] } : {}) }]);
  return identity;
}
async function answer(identity: Awaited<ReturnType<typeof device>>, value: unknown) {
  const claim = await claimJob(identity);
  expect(claim).not.toBeNull();
  expect(JSON.parse(claim!.context).kind).toBe("agent_task");
  await submitResult(identity, { jobId: claim!.job.id, claimToken: claim!.claimToken, sequence: 1, status: "completed", response: typeof value === "string" ? value : JSON.stringify(value) });
  return claim!;
}
async function readyDraft(completion: "draft" | "saved_note" = "draft") {
  const identity = await device();
  const task = await createTask(scope(), { ...makeInput(identity.deviceId), completion });
  await advanceTask(task.id);
  await answer(identity, { version: 1, action: "read", tool: "paper.read", input: {} });
  await advanceTask(task.id);
  await advanceTask(task.id);
  await answer(identity, { version: 1, action: "draft", draft });
  await advanceTask(task.id);
  return { identity, task: await getTask(scope(), task.id) };
}

describe.skipIf(!enabled)("agent tasks on the disposable database", () => {
  beforeEach(async () => {
    process.env.AUTH_SECRET = "agent-isolated-tests-only";
    process.env.AGENT_TASKS_ENABLED = "1";
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["event"] });
    await cleanup();
    for (const id of ["agent-owner", "agent-other"]) await prisma.member.upsert({ where: { id }, create: { id, name: id, handle: `@${id}`, email: `${id}@test.invalid`, role: "멤버", color: "var(--m-ha)", initial: "연" }, update: {} });
    for (const id of ["agent-team", "agent-other-team"]) await prisma.team.create({ data: { id, slug: id, name: id, createdBy: "agent-owner", memberships: { create: { memberId: "agent-owner", role: "owner" } } } });
    await prisma.membership.create({ data: { teamId: "agent-team", memberId: "agent-other", role: "member" } });
    for (const id of ["agent-paper", "agent-foreign"]) await prisma.paper.create({ data: { id, teamId: id === "agent-paper" ? "agent-team" : "agent-other-team", title: id, authors: "Fixture", pdfUrl: "private-storage-key.pdf", uploadedBy: "agent-owner", tags: [], sourceText: JSON.stringify(pages), sourceDigest: "fixture-pdf", analysisStatus: "awaiting_ai" } });
  });
  afterAll(async () => { if (enabled) { await cleanup(); await prisma.$disconnect(); } });

  it("omits unreported effort instead of inventing medium for a legacy model", async () => {
    const identity = await device(scope(), true, false);
    const task = await createTask(scope(), { ...makeInput(identity.deviceId), effort: undefined });
    await advanceTask(task.id);
    const claim = await claimJob(identity);
    expect(claim).not.toBeNull();
    expect(JSON.parse(claim!.context).execution).not.toHaveProperty("effort");
  });

  it("cancels a queued agent decision when its explicit effort disappears from the current catalogue", async () => {
    const identity = await device();
    const task = await createTask(scope(), makeInput(identity.deviceId));
    await advanceTask(task.id);
    const job = await prisma.localAgentJob.findFirstOrThrow({ where: { deviceId: identity.deviceId, purpose: "agent_step" } });
    await desktopHeartbeat(identity, [{ provider: "codex", status: "ready", models: [{ id: "actual-model", name: "Actual fixture model" }], capabilities: ["agent_step_v1"], quota: null, observedAt: new Date(Date.now() + 1).toISOString() }]);
    expect(await claimJob(identity)).toBeNull();
    expect((await prisma.localAgentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
  });

  it("observes authoritative state and disabled reasons without creating schedule rows or leaking paths", async () => {
    const observation = await observePaper(scope(), "agent-paper");
    expect(observation.authority).toBe("domain");
    expect(observation.paper.sourceReady).toBe(true);
    expect(observation.actions.analysis.reason).toMatch(/모델|분석/);
    expect(JSON.stringify(observation)).not.toContain("private-storage-key");
    expect(await prisma.scheduleMonth.count({ where: { teamId: scope().teamId } })).toBe(0);
    await expect(observePaper(scope(), "agent-foreign")).rejects.toMatchObject({ status: 404 });
  });
  it("deduplicates requests, enforces private/team scope and requires a capable live connector", async () => {
    const identity = await device(); const input = makeInput(identity.deviceId);
    const first = await createTask(scope(), input);
    expect((await createTask(scope(), input)).id).toBe(first.id);
    await expect(createTask(scope(), { ...input, goal: "다른 요청" })).rejects.toMatchObject({ status: 409 });
    await expect(createTask(scope(), { ...makeInput(identity.deviceId), paperId: "agent-foreign" })).rejects.toMatchObject({ status: 404 });
    await expect(getTask({ ...scope(), memberId: "agent-other" }, first.id)).rejects.toMatchObject({ status: 404 });
    await expect(getTask({ ...scope(), teamId: "agent-other-team" }, first.id)).rejects.toMatchObject({ status: 404 });
    expect(await listTasks({ ...scope(), memberId: "agent-other" })).toEqual([]);
    const old = await device(scope("old-connector"), false);
    await expect(createTask(scope("old-connector"), makeInput(old.deviceId))).rejects.toMatchObject({ code: "CONNECTOR_UPDATE_REQUIRED" });
  });
  it("runs domain reads and completes a draft without automatically creating a team note", async () => {
    const { task } = await readyDraft();
    expect(task.status).toBe("completed");
    expect(task.draft).toMatchObject(draft);
    expect(task.goalVerified).toBe(true);
    expect(task.savedNote).toBeNull();
    expect(await prisma.sectionNote.count({ where: { paperId: "agent-paper" } })).toBe(0);
    expect(task.activity.some(item => item.label.includes("원문"))).toBe(true);
    expect(JSON.stringify(task)).not.toContain("private-storage-key");
  });
  it("saves only an explicitly reviewed version and independently verifies one actual note", async () => {
    const { task } = await readyDraft("saved_note");
    expect(task.status).toBe("waiting_review");
    const input = { expectedVersion: task.version, title: "검토한 제목", body: "사용자가 검토해 고친 본문" };
    const saved = await saveTaskNote(scope(), task.id, input);
    expect(saved.status).toBe("completed");
    expect(saved.savedNote?.verified).toBe(true);
    const note = await prisma.sectionNote.findUniqueOrThrow({ where: { id: saved.savedNote!.id } });
    expect(note).toMatchObject({ paperId: "agent-paper", authorId: "agent-owner", lens: "research", sectionId: "contributions", title: input.title, body: input.body });
    expect((await saveTaskNote(scope(), task.id, input)).savedNote?.id).toBe(note.id);
    await expect(saveTaskNote(scope(), task.id, { ...input, body: "재전송을 위장한 변경" })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.sectionNote.count({ where: { paperId: "agent-paper" } })).toBe(1);
    await prisma.sectionNote.delete({ where: { id: note.id } });
    expect((await getTask(scope(), task.id)).savedNote?.verified).toBe(false);
  });
  it("does not share a stale, cross-session or revoked draft", async () => {
    const { task } = await readyDraft();
    const input = { expectedVersion: task.version, title: draft.title, body: draft.body };
    await expect(saveTaskNote(scope("new-login"), task.id, input)).rejects.toMatchObject({ status: 403 });
    await prisma.paper.update({ where: { id: "agent-paper" }, data: { sourceDigest: "replaced-pdf" } });
    await expect(saveTaskNote(scope(), task.id, input)).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    await prisma.paper.update({ where: { id: "agent-paper" }, data: { sourceDigest: "fixture-pdf" } });
    await revokeSession(scope().sessionKey);
    expect((await getTask(scope("new-login"), task.id)).draft).toMatchObject(draft);
    await expect(saveTaskNote(scope(), task.id, input)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.sectionNote.count({ where: { paperId: "agent-paper" } })).toBe(0);
  });
  it("serializes simultaneous save requests to one note", async () => {
    const { task } = await readyDraft(); const input = { expectedVersion: task.version, title: draft.title, body: draft.body };
    const results = await Promise.all([saveTaskNote(scope(), task.id, input), saveTaskNote(scope(), task.id, input)]);
    expect(results[0].savedNote?.id).toBe(results[1].savedNote?.id);
    expect(await prisma.sectionNote.count({ where: { paperId: "agent-paper" } })).toBe(1);
  });
  it("invalidates late model results and old reviewed versions after steering or cancellation", async () => {
    const identity = await device(); const task = await createTask(scope(), makeInput(identity.deviceId));
    await advanceTask(task.id); const claim = await claimJob(identity);
    const running = await getTask(scope(), task.id);
    const next = await controlTask(scope(), task.id, { action: "steer", expectedVersion: running.version, goal: "한계에 집중해 다시 정리해줘" });
    await expect(submitResult(identity, { jobId: claim!.job.id, claimToken: claim!.claimToken, sequence: 1, status: "completed", response: JSON.stringify({ version: 1, action: "draft", draft }) })).rejects.toMatchObject({ status: 409 });
    const stopped = await controlTask(scope(), task.id, { action: "cancel", expectedVersion: next.version });
    await advanceTask(task.id);
    expect((await getTask(scope(), task.id)).status).toBe("cancelled");
    await expect(saveTaskNote(scope(), stopped.id, { expectedVersion: stopped.version, title: draft.title, body: draft.body })).rejects.toMatchObject({ status: 409 });
  });
  it("repairs malformed output once and fails repeated unsupported actions without side effects", async () => {
    const identity = await device(); const task = await createTask(scope(), makeInput(identity.deviceId));
    for (let n = 0; n < 2; n++) {
      await advanceTask(task.id); await answer(identity, { version: 1, action: "shell", command: "danger" }); await advanceTask(task.id);
    }
    expect((await getTask(scope(), task.id)).status).toBe("failed");
    expect(await prisma.sectionNote.count({ where: { paperId: "agent-paper" } })).toBe(0);
  });
  it("rejects unsupported citations and a model's unproven finish claim", async () => {
    const identity = await device(); const task = await createTask(scope(), makeInput(identity.deviceId));
    await advanceTask(task.id); await answer(identity, { version: 1, action: "draft", draft }); await advanceTask(task.id);
    await advanceTask(task.id); await answer(identity, { version: 1, action: "finish", message: "저장 완료" }); await advanceTask(task.id);
    expect((await getTask(scope(), task.id)).status).toBe("failed");
  });
  it("keeps a lost dispatch recoverable through the same request and does not claim old capabilities", async () => {
    const identity = await device(); const input = makeInput(identity.deviceId);
    vi.mocked(inngest.send).mockRejectedValueOnce(new Error("delivery failed"));
    await expect(createTask(scope(), input)).rejects.toMatchObject({ code: "QUEUE_UNAVAILABLE" });
    const recovered = await createTask(scope(), input);
    expect(await prisma.agentTask.count({ where: { requestId: input.requestId } })).toBe(1);
    await advanceTask(recovered.id);
    await desktopHeartbeat(identity, [{ provider: "codex", status: "ready", models: [{ id: "actual-model", name: "Old model" }], quota: null, observedAt: new Date().toISOString() }]);
    expect(await claimJob(identity)).toBeNull();
  });
  it("waits for a new explicit connection after grant expiry and keeps private history readable", async () => {
    const identity = await device(); const task = await createTask(scope(), makeInput(identity.deviceId));
    await revokeSession(scope().sessionKey); await advanceTask(task.id);
    expect((await getTask(scope("new-session"), task.id)).status).toBe("waiting_connection");
    const nextScope = scope("new-session"); const nextDevice = await device(nextScope);
    const waiting = await getTask(nextScope, task.id);
    const resumed = await controlTask(nextScope, task.id, { action: "resume", expectedVersion: waiting.version, deviceId: nextDevice.deviceId, provider: "codex", model: "actual-model", effort: "medium" });
    expect(resumed.status).toBe("queued");
    await advanceTask(task.id); expect(await claimJob(nextDevice)).not.toBeNull();
  });
  it("prepares a seminar, reviews it, and creates one linked presentation with independently verified slides", async () => {
    const identity = await device();
    const task = await createTask(scope(), { ...makeInput(identity.deviceId), kind: "seminar", completion: "saved_presentation" });
    await advanceTask(task.id);
    await answer(identity, { version: 1, action: "read", tool: "paper.read", input: {} });
    await advanceTask(task.id); await advanceTask(task.id);
    await answer(identity, { version: 1, action: "seminar_draft", draft: seminar });
    await advanceTask(task.id);
    const ready = await getTask(scope(), task.id);
    expect(ready.status).toBe("waiting_review");
    expect(ready.seminarDraft).toMatchObject(seminar);
    expect(await prisma.presentation.count({ where: { teamId: scope().teamId } })).toBe(0);
    const input = { expectedVersion: ready.version, seminar: { ...seminar, title: "검토한 세미나 제목" } };
    const saved = await saveTaskSeminar(scope(), task.id, input);
    expect(saved.savedPresentation?.verified).toBe(true);
    expect(saved.goalVerified).toBe(true);
    const actual = await prisma.presentation.findUniqueOrThrow({ where: { id: saved.savedPresentation!.id } });
    expect(actual).toMatchObject({ teamId: scope().teamId, presenterId: scope().memberId, sourcePaperId: "agent-paper", title: input.seminar.title, slides: seminar.slides, slideCount: 3 });
    expect((await saveTaskSeminar(scope(), task.id, input)).savedPresentation?.id).toBe(actual.id);
    await expect(saveTaskSeminar(scope(), task.id, { ...input, seminar: { ...seminar, title: "다른 내용" } })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.presentation.count({ where: { teamId: scope().teamId } })).toBe(1);
    expect(await prisma.scheduleMonth.count({ where: { teamId: scope().teamId } })).toBe(0);
    expect(await prisma.liveSession.count({ where: { teamId: scope().teamId } })).toBe(0);
  });
  it("does not let a failed old tick overwrite a concurrently steered revision", async () => {
    const identity = await device();
    const task = await createTask(scope(), makeInput(identity.deviceId));
    const realTransaction = prisma.$transaction.bind(prisma);
    const transaction = vi.spyOn(prisma, "$transaction").mockImplementation(realTransaction).mockImplementationOnce(async () => {
      await controlTask(scope(), task.id, { action: "steer", expectedVersion: task.version, goal: "새 목표로 세 가지 토론 질문을 준비해줘" });
      throw new Error("Old tick connection failed after the new revision committed");
    });
    try {
      await advanceTask(task.id);
      expect(await getTask(scope(), task.id)).toMatchObject({ status: "queued", revision: 1, goal: "새 목표로 세 가지 토론 질문을 준비해줘" });
    } finally { transaction.mockRestore(); prisma.$transaction = realTransaction; }
  });
  it("ignores a durable event from the previous task revision", async () => {
    const identity = await device();
    const task = await createTask(scope(), makeInput(identity.deviceId));
    const next = await controlTask(scope(), task.id, { action: "steer", expectedVersion: task.version, goal: "최신 목표로 준비해줘" });
    expect(await advanceTask(task.id, task.revision)).toBeNull();
    expect(await getTask(scope(), task.id)).toMatchObject({ status: "queued", version: next.version, decisionCount: 0 });
    expect(await claimJob(identity)).toBeNull();
  });
  it("runs a guided PT conversation from paper-first directions through an explicit outline and a grounded diagram deck", async () => {
    const identity = await device();
    const task = await createTask(scope(), { ...makeInput(identity.deviceId), kind: "seminar", workflow: "guided", completion: "saved_presentation" });
    await advanceTask(task.id);
    const claim = await claimJob(identity);
    expect(claim).not.toBeNull();
    const context = JSON.parse(claim!.context);
    expect(context.results["paper.read"].pages[0].text).toContain("sparse routing");
    expect(context.workspace.pending).toBe("directions");
    const directions = ["method", "critique"].map(id => ({ id, title: id, message: "라우팅의 조건을 검토한다", focus: "실험 조건", tradeoff: "구현은 짧게", citations: draft.citations }));
    await submitResult(identity, { jobId: claim!.job.id, claimToken: claim!.claimToken, sequence: 1, status: "completed", response: JSON.stringify({ version: 1, action: "seminar_directions", message: "원문에서 두 가지 발표 방향을 찾았어요.", directions }) });
    await advanceTask(task.id);
    let ready = await getTask(scope(), task.id);
    expect(ready.status).toBe("waiting_input"); expect(ready.workspace?.directions).toHaveLength(2);
    expect(ready.requiresReconnect).toBe(false);
    expect((await getTask(scope("later-login"),task.id)).requiresReconnect).toBe(true);
    const choose = { expectedVersion: ready.version, requestId: crypto.randomUUID(), action: "choose" as const, directionId: "method" };
    const chosen = await continueSeminarTask(scope(), task.id, choose);
    expect((await continueSeminarTask(scope(), task.id, choose)).revision).toBe(chosen.revision);
    await expect(continueSeminarTask({ ...scope(), memberId: "agent-other" }, task.id, choose)).rejects.toMatchObject({ status: 404 });
    await advanceTask(task.id);
    await answer(identity, { version: 1, action: "seminar_question", message: "방법을 중심으로 발표를 잡았어요.", brief: { audience: "재현에 관심이 있는 팀원" }, question: { id: "depth", text: "어떤 깊이로 설명할까요?", options: [{ id: "core", label: "핵심 개념" }, { id: "repro", label: "재현 단계" }], recommendedId: "repro", reason: "청중의 관심과 맞아요." } });
    await advanceTask(task.id); ready = await getTask(scope(), task.id);
    expect(ready.workspace?.question?.id).toBe("depth"); expect(ready.workspace?.brief.audience).toContain("재현");
    await continueSeminarTask(scope(), task.id, { expectedVersion: ready.version, requestId: crypto.randomUUID(), action: "outline" });
    await advanceTask(task.id);
    const outline = seminar.slides.map((slide, index) => ({ id: `s${index}`, title: slide.title, claim: slide.body, visualPlan: "설명 도식", sourcePages: [1] }));
    await answer(identity, { version: 1, action: "seminar_outline", message: "목차를 준비했어요.", brief: {}, outline });
    await advanceTask(task.id); ready = await getTask(scope(), task.id);
    expect(ready.workspace?.outline).toHaveLength(3); expect(ready.canSave).toBe(false);
    await continueSeminarTask(scope(), task.id, { expectedVersion: ready.version, requestId: crypto.randomUUID(), action: "build" });
    await advanceTask(task.id);
    const diagramDeck = { ...seminar, slides: seminar.slides.map(slide => ({ ...slide, citations: draft.citations, visual: { kind: "diagram" as const, caption: "설명용 재구성", nodes: [{ id: "a", label: "입력" }, { id: "b", label: "라우팅" }], edges: [{ from: "a", to: "b" }] } })) };
    await answer(identity, { version: 1, action: "seminar_draft", draft: diagramDeck });
    await advanceTask(task.id); ready = await getTask(scope(), task.id);
    expect(ready.workspace?.stage).toBe("deck"); expect(ready.seminarDraft?.slides[0].visual?.kind).toBe("diagram");
    const resumeScope = scope("deck-resume-session"), resumedDevice = await device(resumeScope);
    const resumed = await controlTask(resumeScope,task.id,{ action: "resume",expectedVersion: ready.version,deviceId: resumedDevice.deviceId });
    expect(resumed.revision).toBe(ready.revision);
    expect(resumed.workspace?.messages).toEqual(ready.workspace?.messages);
    ready = await controlTask(scope(),task.id,{ action: "resume",expectedVersion: resumed.version,deviceId: identity.deviceId });
    expect(await prisma.presentation.count({ where: { teamId: scope().teamId } })).toBe(0);
    const sourcePdf = await PDFDocument.create(); sourcePdf.addPage().drawText(pages[0].text,{ x: 40,y: 700,size: 12,maxWidth: 500 });
    storage.set("private-storage-key.pdf",Buffer.from(await sourcePdf.save()));
    storage.set("private/source-figure.png",await sharp({ create: { width: 640,height: 360,channels: 3,background: "white" } }).png().toBuffer());
    await prisma.figure.create({ data: { id: "source-figure",paperId: "agent-paper",title: "Source fixture figure",caption: "원문 그림",interpretation: "검증 자산",sourcePage: 1,imageUrl: "private/source-figure.png" } });
    const mediaDeck = { ...diagramDeck,slides: [{ ...diagramDeck.slides[0],visual: { kind: "figure" as const,figureId: "source-figure",caption: "실제 원문 그림" } },{ ...diagramDeck.slides[1],visual: { kind: "page" as const,page: 1,caption: "실제 원문 페이지" } },diagramDeck.slides[2]] };
    await expect(saveTaskSeminar(scope(),task.id,{ expectedVersion: ready.version,seminar: mediaDeck })).rejects.toMatchObject({ code: "EXPORT_REVIEW_REQUIRED" });
    const exportInput = { requestId: crypto.randomUUID(), expectedVersion: ready.version, seminar: mediaDeck };
    await expect(queueSeminarExport({ ...scope(), memberId: "agent-other" }, task.id, exportInput)).rejects.toMatchObject({ status: 404 });
    vi.mocked(assertGeneratedPresentationStorage).mockImplementationOnce(() => { throw new HttpError(503,"STORAGE_UNAVAILABLE","발표 파일 저장 기능을 아직 연결하지 않았어요."); });
    await expect(queueSeminarExport(scope(),task.id,exportInput)).rejects.toMatchObject({ status: 503 });
    expect(await prisma.job.count({ where: { type: "seminar_export" } })).toBe(0);
    const queued = await queueSeminarExport(scope(), task.id, exportInput);
    expect(queued.export.status).toBe("queued");
    expect((await queueSeminarExport(scope(), task.id, exportInput)).export.id).toBe(queued.export.id);
    await expect(queueSeminarExport(scope(), task.id, { ...exportInput, seminar: { ...diagramDeck, title: "다른 요청" } })).rejects.toMatchObject({ status: 409 });
    await expect(getSeminarExport({ ...scope(), memberId: "agent-other" }, task.id, queued.export.id)).rejects.toMatchObject({ status: 404 });
    await prisma.localAgentGrant.updateMany({ where: { teamId: scope().teamId,memberId: scope().memberId },data: { leaseExpiresAt: new Date(Date.now()-1000) } });
    await runSeminarExport(queued.export.id);
    const fileCount = storage.size; await runSeminarExport(queued.export.id); expect(storage.size).toBe(fileCount);
    const artifact = await getSeminarExport(scope(), task.id, queued.export.id);
    expect(artifact).toMatchObject({ status: "done", current: true, qa: { slideCount: 3, aspectRatio: "16:9", issues: [] } });
    expect(JSON.stringify(artifact)).not.toContain("seminars/");
    expect((await downloadSeminarExport(scope(), task.id, artifact.id, "pdf")).bytes.subarray(0,4).toString()).toBe("%PDF");
    expect((await downloadSeminarExport(scope(), task.id, artifact.id, "html")).bytes.toString()).toContain('data-slide="0"');
    expect((await downloadSeminarExport(scope(), task.id, artifact.id, "html")).bytes.toString()).toContain("data:image/png;base64,");
    await renewWebPermission(scope(),identity.deviceId);
    const current = await getTask(scope(), task.id);
    const saved = await saveTaskSeminar(scope(), task.id, { expectedVersion: current.version, seminar: mediaDeck, artifactJobId: artifact.id });
    expect(saved.savedPresentation?.verified).toBe(true); expect(saved.workspace?.messages.length).toBeGreaterThan(5);
    expect((await prisma.presentationAsset.findMany({ where: { presentationId: saved.savedPresentation!.id } })).map(row => row.type).sort()).toEqual(["html", "pdf"]);
    const htmlAsset = await prisma.presentationAsset.findFirstOrThrow({ where: { presentationId: saved.savedPresentation!.id,type: "html" } });
    await prisma.presentationAsset.delete({ where: { id: htmlAsset.id } });
    expect((await getTask(scope(),task.id)).savedPresentation?.verified).toBe(false);
    await prisma.presentationAsset.create({ data: htmlAsset });
    const exportScope = scope("new-export-session"); await device(exportScope);
    const publishedExport = await queueSeminarExport(exportScope,task.id,{ ...exportInput,requestId: crypto.randomUUID(),expectedVersion: saved.version });
    await prisma.presentation.update({ where: { id: saved.savedPresentation!.id },data: { summary: "다른 화면에서 수정한 발표 소개" } });
    await runSeminarExport(publishedExport.export.id);
    expect((await getSeminarExport(scope(),task.id,publishedExport.export.id)).status).toBe("failed");
    expect(await prisma.presentationAsset.count({ where: { presentationId: saved.savedPresentation!.id } })).toBe(2);
    await prisma.presentation.update({ where: { id: saved.savedPresentation!.id },data: { summary: mediaDeck.summary } });
    const afterChange = await getTask(scope(),task.id);
    const afterPublish = await queueSeminarExport(exportScope,task.id,{ ...exportInput,requestId: crypto.randomUUID(),expectedVersion: afterChange.version });
    await runSeminarExport(afterPublish.export.id);
    expect((await getSeminarExport(scope(),task.id,afterPublish.export.id)).status).toBe("done");
    expect(await prisma.presentationAsset.count({ where: { presentationId: saved.savedPresentation!.id } })).toBe(4);
    await prisma.paper.update({ where: { id: "agent-paper" }, data: { sourceDigest: "changed-after-export" } });
    expect((await getTask(scope(),task.id)).sourceChanged).toBe(true);
    expect((await getSeminarExport(scope(), task.id, artifact.id)).current).toBe(false);
    await expect(downloadSeminarExport(scope(), task.id, artifact.id, "pdf")).rejects.toMatchObject({ status: 409 });
  },30_000);
});
