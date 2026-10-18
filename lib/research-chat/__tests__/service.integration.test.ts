// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  return { prisma: new PrismaClient({ datasources: { db: { url } } }) };
});
import { prisma } from "@/lib/prisma";
import { acknowledgeDesktop, claimJob, createAttempt, desktopHeartbeat, pairDesktop, revokeSession, submitResult, type LocalAgentScope } from "@/lib/local-agent/service";
import { cancelTurn, createConversation, createTurn, getConversation, listConversations, listResearchPapers } from "../service";
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
  it("refuses unprepared sources without queuing work and preserves the draft conversation", async () => {
    const identity = await readyDevice();
    const thread = await conversation([ids[3]]);
    await expect(createTurn(scope(), thread.id, target(identity.deviceId))).rejects.toMatchObject({ status: 409, code: "SOURCE_NOT_READY" });
    expect((await getConversation(scope(), thread.id)).turns).toEqual([]);
    expect((await listResearchPapers(scope())).find(paper => paper.id === ids[3])?.sourceReady).toBe(false);
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
