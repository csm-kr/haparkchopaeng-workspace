// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient as ApplicationPrismaClient } from "@prisma/client";
const preparationRace = vi.hoisted(() => ({ afterVerified: null as null | (() => Promise<void>) }));
vi.mock("@/lib/inngest", () => ({ inngest: { send: vi.fn().mockResolvedValue({ ids: ["event"] }) } }));
vi.mock("@/lib/prisma", async () => {
  const modulePath = process.env.LOCAL_AGENT_TEST_CLIENT_MODULE;
  if (!modulePath) return { prisma: {} };
  const url = process.env.LOCAL_AGENT_TEST_DATABASE_URL;
  const directory = process.env.HAPARK_TEST_DIRECTORY;
  if (!url || !directory) throw new Error("Research chat integration requires an isolated SQLite database");
  const { createRequire } = await import("node:module");
  const { isAbsolute } = await import("node:path");
  if (!isAbsolute(modulePath)) throw new Error("Expected an absolute isolated Prisma client path");
  const require = createRequire(import.meta.url);
  const { assertIsolatedDatabase } = require("../../../scripts/local-agent-verify.mjs");
  assertIsolatedDatabase(directory, url);
  const { PrismaClient } = require(modulePath);
  const client: ApplicationPrismaClient = new PrismaClient({ datasources: { db: { url } } });
  return { prisma: client.$extends({ query: { presentation: { async findFirst({ args, query }) {
    const result = await query(args);
    const race = preparationRace.afterVerified;
    if (race) { preparationRace.afterVerified = null; await race(); }
    return result;
  } } } }) };
});
import { prisma } from "@/lib/prisma";
import { acknowledgeDesktop, claimJob, createAttempt, desktopHeartbeat, pairDesktop, revokeSession, submitResult, type LocalAgentScope } from "@/lib/local-agent/service";
import { cancelTurn, createConversation, createTurn, getConversation, listConversations, listResearchPapers } from "../service";
import { assertChatPreparation, beginChatPreparation, finishChatPreparation } from "../preparation";
import type { PreparedPdfSource } from "@/worker/prepare-pdf-source";
const enabled = Boolean(process.env.LOCAL_AGENT_TEST_CLIENT_MODULE);
const scope = (sessionKey = "chat-session"): LocalAgentScope => ({ memberId: "chat-test-owner", teamId: "chat-test-a", sessionKey, sessionExpiresAt: new Date(Date.now() + 3_600_000) });
const ids = ["chat-test-paper-a", "chat-test-paper-b", "chat-test-paper-foreign", "chat-test-paper-unprepared"];
const source = JSON.stringify([{ page: 1, text: "원문에서만 확인되는 근거: 효율은 기준 대비 두 배다." }]);
const target = (deviceId: string, requestId = crypto.randomUUID()) => ({ deviceId, requestId, provider: "codex" as const, model: "actual-model", prompt: "논문의 실험 근거를 비교해줘" });
async function cleanup() {
  await prisma.paper.deleteMany({ where: { id: { in: ids } } });
  await prisma.team.deleteMany({ where: { id: { in: ["chat-test-a", "chat-test-b"] } } });
}
async function readyDevice(s = scope()) {
  const deviceToken = Buffer.alloc(32, s.sessionKey === "chat-session" ? 21 : 22).toString("base64url");
  const attempt = await createAttempt(s);
  await acknowledgeDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, deviceName: "Chat fixture PC", platform: "windows" });
  const paired = await pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, code: attempt.code ?? "" });
  if (!paired.deviceId) throw new Error("Fixture pairing did not create a device");
  const identity = { deviceId: paired.deviceId, deviceToken };
  await desktopHeartbeat(identity, [{ provider: "codex", status: "ready", models: [{ id: "actual-model", name: "Actual fixture model" }], quota: null, observedAt: new Date().toISOString() }]);
  return identity;
}
async function conversation(paperIds = ids.slice(0, 2)) { return createConversation(scope(), { requestId: crypto.randomUUID(), paperIds }); }

describe.skipIf(!enabled)("private research conversations on the isolated database", () => {
  beforeEach(async () => {
    preparationRace.afterVerified = null;
    process.env.AUTH_SECRET = "research-chat-isolated-tests-only";
    await cleanup();
    for (const id of ["chat-test-owner", "chat-test-other"]) await prisma.member.upsert({ where: { id }, create: { id, name: id, handle: `@${id}`, email: `${id}@test.invalid`, role: "멤버", color: "var(--m-ha)", initial: "연" }, update: {} });
    for (const id of ["chat-test-a", "chat-test-b"]) await prisma.team.create({ data: { id, slug: id, name: id, createdBy: "chat-test-owner", memberships: { create: { memberId: "chat-test-owner", role: "owner" } } } });
    await prisma.membership.create({ data: { teamId: "chat-test-a", memberId: "chat-test-other", role: "member" } });
    for (const id of ids) await prisma.paper.create({ data: { id, teamId: id.includes("foreign") ? "chat-test-b" : "chat-test-a", title: `Fixture ${id}`, authors: "CI", pdfUrl: "fixture.pdf", uploadedBy: "chat-test-owner", tags: [], sourceText: id.includes("unprepared") ? null : source } });
  });
  afterAll(async () => { if (enabled) { await cleanup(); await prisma.$disconnect(); } });

  it("creates idempotent owned conversations and hides them from another member/team", async () => {
    const input = { requestId: crypto.randomUUID(), title: "근거 비교", paperIds: ids.slice(0, 2) };
    const first = await createConversation(scope(), input);
    expect((await createConversation(scope(), input)).id).toBe(first.id);
    await expect(createConversation(scope(), { ...input, paperIds: [ids[0]] })).rejects.toMatchObject({ status: 409, code: "REQUEST_ID_REUSED" });
    expect(await listConversations(scope())).toHaveLength(1);
    await expect(getConversation({ ...scope(), memberId: "chat-test-other" }, first.id)).rejects.toMatchObject({ status: 404 });
    await expect(getConversation({ ...scope(), teamId: "chat-test-b" }, first.id)).rejects.toMatchObject({ status: 404 });
    await expect(conversation([ids[2]])).rejects.toMatchObject({ status: 404 });
    expect((await listResearchPapers(scope())).map(paper => paper.id)).not.toContain(ids[2]);
  });
  it("starts free chat, adds a seminar and paper mid-conversation, and clears them without rewriting past sources", async () => {
    const identity = await readyDevice();
    await prisma.presentation.create({ data: { id: "chat-test-presentation", teamId: scope().teamId, presenterId: scope().memberId, title: "토요일 세미나", date: new Date(), tags: [], keypoints: ["실험 가정"], slides: [{ title: "세미나 실험", body: "발표에서 설명한 대조군" }] } });
    const thread = await conversation([]);
    const first = await createTurn(scope(), thread.id, { ...target(identity.deviceId), prompt: "안녕! 함께 연구 아이디어를 생각해보자." });
    expect(first.paperId).toBe("");
    expect(first.materials).toEqual([]);
    expect(first.effort).toBeUndefined();
    expect(JSON.parse((await prisma.localAgentJob.findUniqueOrThrow({ where: { id: first.id } })).context)).not.toHaveProperty("execution");
    await cancelTurn(scope(), thread.id, first.id);
    await desktopHeartbeat(identity, [{ provider: "codex", status: "ready", models: [{ id: "actual-model", name: "Actual fixture model", reasoningEfforts: ["low", "high"] }], quota: null, observedAt: new Date().toISOString() }]);
    const secondInput = { ...target(identity.deviceId), effort: "high" as const, paperIds: [ids[0]], presentationIds: ["chat-test-presentation"] };
    const second = await createTurn(scope(), thread.id, secondInput);
    expect(second.materials).toEqual([{ kind: "paper", id: ids[0], title: `Fixture ${ids[0]}` }, { kind: "presentation", id: "chat-test-presentation", title: "토요일 세미나" }]);
    const claimed = await claimJob(identity);
    expect(claimed?.context).toContain("발표에서 설명한 대조군");
    expect(JSON.parse(claimed!.context).execution.effort).toBe("high");
    await expect(createTurn(scope(), thread.id, { ...secondInput, effort: "low" })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
    await cancelTurn(scope(), thread.id, second.id);
    const third = await createTurn(scope(), thread.id, { ...target(identity.deviceId), paperIds: [], presentationIds: [] });
    expect(third.materials).toEqual([]);
    const saved = await getConversation(scope(), thread.id);
    expect(saved.papers).toEqual([]);
    expect(saved.presentations).toEqual([]);
    expect(saved.turns[1].materials).toEqual(second.materials);
    await cancelTurn(scope(), thread.id, third.id);
    await expect(createTurn(scope(), thread.id, { ...target(identity.deviceId), paperIds: [ids[2]] })).rejects.toMatchObject({ status: 404 });
    await expect(createTurn(scope(), thread.id, { ...target(identity.deviceId), presentationIds: ["missing-seminar"] })).rejects.toMatchObject({ status: 404 });
  });
  it("queues raw source context, serializes turns and preserves one request across network retries", async () => {
    const identity = await readyDevice();
    const thread = await conversation();
    const input = target(identity.deviceId);
    const first = await createTurn(scope(), thread.id, input);
    expect(first.conversationTurn).toBe(1);
    expect(first.canCancel).toBe(true);
    expect((await createTurn(scope(), thread.id, input)).id).toBe(first.id);
    await expect(createTurn(scope(), thread.id, { ...input, prompt: "다른 질문" })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
    await expect(createTurn(scope(), thread.id, target(identity.deviceId))).rejects.toMatchObject({ code: "CONVERSATION_BUSY" });
    const stored = await prisma.localAgentJob.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.purpose).toBe("chat");
    expect(stored.context).toContain("원문에서만 확인되는 근거");
    expect(stored.context).not.toContain("fixture.pdf");
    const cancelled = await cancelTurn(scope(), thread.id, first.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.canCancel).toBe(false);
    expect((await createTurn(scope(), thread.id, target(identity.deviceId))).conversationTurn).toBe(2);
  });
  it("keeps history after selected papers or seminars are removed while new execution remains strict", async () => {
    const identity = await readyDevice();
    const seminarId = "chat-test-deleted-presentation";
    await prisma.presentation.create({ data: { id: seminarId, teamId: scope().teamId, presenterId: scope().memberId,
      title: "삭제 전 세미나", date: new Date(), tags: [], keypoints: ["당시 세미나 근거"], slides: [] } });
    const thread = await createConversation(scope(), { requestId: crypto.randomUUID(), paperIds: [ids[0]], presentationIds: [seminarId] });
    const turn = await createTurn(scope(), thread.id, target(identity.deviceId));
    const claim = await claimJob(identity);
    if (!claim) throw new Error("History fixture job was not claimed");
    await submitResult(identity, { jobId: turn.id, claimToken: claim.claimToken, sequence: 1, status: "completed", response: "삭제 이후에도 남는 답변" });
    await prisma.paper.delete({ where: { id: ids[0] } });
    await prisma.presentation.delete({ where: { id: seminarId } });
    const saved = await getConversation(scope(), thread.id);
    expect(saved.conversation.paperIds).toEqual([]);
    expect(saved.conversation.presentationIds).toEqual([]);
    expect(saved.turns[0]).toMatchObject({ response: "삭제 이후에도 남는 답변", materials: [
      { id: ids[0], title: `Fixture ${ids[0]}`, kind: "paper" }, { id: seminarId, title: "삭제 전 세미나", kind: "presentation" },
    ] });
    await expect(createTurn(scope(), thread.id, { ...target(identity.deviceId), paperIds: [ids[0]], presentationIds: [] })).rejects.toMatchObject({ status: 404 });
    await expect(createTurn(scope(), thread.id, { ...target(identity.deviceId), paperIds: [], presentationIds: [seminarId] })).rejects.toMatchObject({ status: 404 });
    const free = await createTurn(scope(), thread.id, { ...target(identity.deviceId), paperIds: [], presentationIds: [] });
    expect(free.materials).toEqual([]);
    await cancelTurn(scope(), thread.id, free.id);
  });
  it("keeps history after logout but a new session cannot execute or cancel with old authority", async () => {
    const identity = await readyDevice();
    const thread = await conversation();
    const first = await createTurn(scope(), thread.id, target(identity.deviceId));
    const claim = await claimJob(identity);
    if (!claim) throw new Error("Fixture job was not claimed");
    await submitResult(identity, { jobId: first.id, claimToken: claim.claimToken, sequence: 1, status: "completed", response: "완료된 근거 답변" });
    const pending = await createTurn(scope(), thread.id, target(identity.deviceId));
    const otherSession = scope("fresh-chat-session");
    const before = await prisma.localAgentGrant.findFirstOrThrow({ where: { deviceId: identity.deviceId } });
    expect((await getConversation(otherSession, thread.id)).turns).toHaveLength(2);
    expect((await prisma.localAgentGrant.findUniqueOrThrow({ where: { id: before.id } })).leaseExpiresAt).toEqual(before.leaseExpiresAt);
    await expect(cancelTurn(otherSession, thread.id, pending.id)).rejects.toMatchObject({ status: 404 });
    await revokeSession(scope().sessionKey);
    const history = await getConversation(otherSession, thread.id);
    expect(history.turns.map(turn => turn.status)).toEqual(["completed", "cancelled"]);
    expect(history.turns[0].response).toBe("완료된 근거 답변");
    expect(history.turns.every(turn => !turn.canCancel)).toBe(true);
    await expect(createTurn(otherSession, thread.id, target(identity.deviceId))).rejects.toMatchObject({ status: 403 });
  });
  it("automatically prepares unprepared sources and lets the user cancel before inference", async () => {
    const identity = await readyDevice();
    const thread = await conversation([ids[3]]);
    const pending = await createTurn(scope(), thread.id, target(identity.deviceId));
    expect(pending.status).toBe("preparing");
    expect(await claimJob(identity)).toBeNull();
    expect((await cancelTurn(scope(), thread.id, pending.id)).status).toBe("cancelled");
    expect((await listResearchPapers(scope())).find(paper => paper.id === ids[3])?.sourceReady).toBe(false);
  });
  it("publishes complete OCR sources through the actual preparing/version CAS without renewing the grant", async () => {
    const identity = await readyDevice();
    const thread = await conversation([ids[3]]);
    const pending = await createTurn(scope(), thread.id, target(identity.deviceId));
    const before = await prisma.localAgentGrant.findFirstOrThrow({ where: { deviceId: identity.deviceId } });
    const plan = await beginChatPreparation(pending.id);
    expect(plan).not.toBeNull();
    const text = JSON.stringify([{ page: 1, text: "문자 인식으로 읽은 합성 논문의 근거입니다.", method: "ocr" }]);
    await prisma.paper.update({ where: { id: ids[3] }, data: { sourceText: text, sourceDigest: "e".repeat(64), pageCount: 1 } });
    const prepared: PreparedPdfSource = { target: { kind: "paper", id: ids[3], teamId: scope().teamId },
      objectKey: "fixture.pdf", assetId: null, source: { text, digest: "e".repeat(64), pageCount: 1 } };
    await assertChatPreparation(plan!);
    await finishChatPreparation(plan!, [prepared]);
    const stored = await prisma.localAgentJob.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored.status).toBe("queued");
    expect(stored.version).toBe(plan!.version + 1);
    expect(JSON.parse(stored.context).papers[0].pages[0].method).toBe("ocr");
    expect((await prisma.localAgentGrant.findUniqueOrThrow({ where: { id: before.id } })).leaseExpiresAt).toEqual(before.leaseExpiresAt);
    expect((await claimJob(identity))?.job.id).toBe(pending.id);
  });
  it("cannot revive cancelled or expired preparation after durable source results arrive", async () => {
    const identity = await readyDevice();
    const thread = await conversation([ids[3]]);
    const first = await createTurn(scope(), thread.id, target(identity.deviceId));
    const cancelledPlan = await beginChatPreparation(first.id);
    await cancelTurn(scope(), thread.id, first.id);
    await expect(assertChatPreparation(cancelledPlan!)).rejects.toMatchObject({ code: "PREPARATION_ENDED" });
    await finishChatPreparation(cancelledPlan!, []);
    expect((await prisma.localAgentJob.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("cancelled");
    const second = await createTurn(scope(), thread.id, target(identity.deviceId));
    const expiredPlan = await beginChatPreparation(second.id);
    await prisma.localAgentGrant.updateMany({ where: { deviceId: identity.deviceId }, data: { leaseExpiresAt: new Date(0) } });
    await expect(assertChatPreparation(expiredPlan!)).rejects.toMatchObject({ code: "PREPARATION_ENDED" });
    await finishChatPreparation(expiredPlan!, []);
    expect((await prisma.localAgentJob.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("preparing");
    await expect(claimJob(identity)).rejects.toMatchObject({ code: "WEB_PERMISSION_EXPIRED" });
  });
  it("rejects an actual PDF replacement committed just after source verification without queueing old text", async () => {
    const identity = await readyDevice();
    const seminarId = "chat-test-prepare-replaced";
    await prisma.presentation.create({ data: { id: seminarId, teamId: scope().teamId, presenterId: scope().memberId, title: "Replacement fixture",
      date: new Date(), tags: [], keypoints: [], slides: [], assets: { create: { id: "chat-test-prepare-old-asset", name: "synthetic.pdf", type: "pdf", size: "100 B", url: "presentations/old-synthetic.pdf" } } } });
    const thread = await createConversation(scope(), { requestId: crypto.randomUUID(), paperIds: [], presentationIds: [seminarId] });
    const pending = await createTurn(scope(), thread.id, target(identity.deviceId));
    expect(pending.status).toBe("preparing");
    const plan = await beginChatPreparation(pending.id);
    const prepared: PreparedPdfSource = { target: { kind: "presentation", id: seminarId, teamId: scope().teamId },
      objectKey: "presentations/old-synthetic.pdf", assetId: "chat-test-prepare-old-asset",
      source: { text: JSON.stringify([{ page: 1, text: "Old complete synthetic seminar text" }]), digest: "a".repeat(64), pageCount: 1 } };
    preparationRace.afterVerified = async () => {
      await prisma.presentationAsset.update({ where: { id: "chat-test-prepare-old-asset" }, data: { url: "presentations/new-synthetic.pdf" } });
    };
    await expect(finishChatPreparation(plan!, [prepared])).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    const stored = await prisma.localAgentJob.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored.status).toBe("preparing");
    expect(stored.context).not.toContain("Old complete synthetic seminar text");
    expect((await prisma.presentationAsset.findUniqueOrThrow({ where: { id: "chat-test-prepare-old-asset" } })).url).toBe("presentations/new-synthetic.pdf");
    await prisma.presentation.delete({ where: { id: seminarId } });
  });
  it("admits only one simultaneous turn and deduplicates simultaneous identical requests", async () => {
    const identity = await readyDevice();
    const thread = await conversation();
    const input = target(identity.deviceId);
    const duplicate = await Promise.all([createTurn(scope(), thread.id, input), createTurn(scope(), thread.id, input)]);
    expect(duplicate[0].id).toBe(duplicate[1].id);
    await cancelTurn(scope(), thread.id, duplicate[0].id);
    const results = await Promise.allSettled([createTurn(scope(), thread.id, target(identity.deviceId)), createTurn(scope(), thread.id, target(identity.deviceId))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.localAgentJob.count({ where: { conversationId: thread.id, status: { in: ["queued", "running"] } } })).toBe(1);
  });
});
