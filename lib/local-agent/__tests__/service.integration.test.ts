// @vitest-environment node
// This suite never uses the application's configured/shared database. The verifier supplies
// an independently generated SQLite client and a temporary file: datasource explicitly.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", async () => {
  const clientModule = process.env.LOCAL_AGENT_TEST_CLIENT_MODULE;
  if (!clientModule) return { prisma: {} };
  const url = process.env.LOCAL_AGENT_TEST_DATABASE_URL;
  if (!url || !process.env.HAPARK_TEST_DIRECTORY) throw new Error("Local-agent integration tests require an isolated SQLite database");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { assertIsolatedDatabase } = require("../../../scripts/local-agent-verify.mjs");
  assertIsolatedDatabase(process.env.HAPARK_TEST_DIRECTORY, url);
  const { isAbsolute } = await import("node:path");
  if (!isAbsolute(clientModule)) throw new Error("Local-agent test client must be an absolute path");
  const { PrismaClient } = require(clientModule);
  return { prisma: new PrismaClient({ datasources: { db: { url } } }) };
});
vi.mock("@/lib/auth", () => ({ requireAuth: async () => ({ memberId: "la-test-ha", role: "관리자" }) }));
import { prisma } from "@/lib/prisma";
import { acknowledgeDesktop, cancelAttempt, cancelJob, claimJob, createAttempt, createJob, desktopHeartbeat, getAttempt, getJob, getStatus, pairDesktop, renewWebPermission, revokeDevice, revokeSession, submitResult, type LocalAgentScope } from "../service";
import type { LocalAgentProviderSnapshot } from "@/types/local-agent";
const enabled = Boolean(process.env.LOCAL_AGENT_TEST_CLIENT_MODULE);
const key = Buffer.alloc(32, 1).toString("base64url");
const otherKey = Buffer.alloc(32, 2).toString("base64url");
const scope = (): LocalAgentScope => ({ teamId: "la-test-a", memberId: "la-test-ha", sessionKey: "web-session-a", sessionExpiresAt: new Date(Date.now() + 3_600_000) });
const snapshot = (overrides: Partial<LocalAgentProviderSnapshot> = {}): LocalAgentProviderSnapshot => ({ provider: "codex", status: "ready", models: [{ id: "actual-codex-model", name: "Actual Codex model" }], quota: null, observedAt: new Date().toISOString(), ...overrides });

async function pair(s = scope(), deviceToken = key) {
  const attempt = await createAttempt(s);
  const ack = await acknowledgeDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, deviceName: "연구 PC", platform: "windows" });
  expect(ack.status).toBe("awaiting_code");
  expect("code" in ack).toBe(false);
  const paired = await pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, code: attempt.code ?? "" });
  if (!paired.deviceId) throw new Error("Test pairing did not return a device");
  return { attempt, paired, identity: { deviceId: paired.deviceId, deviceToken } };
}
async function job(deviceId: string, requestId = crypto.randomUUID()) {
  return createJob(scope(), { deviceId, paperId: "la-test-paper-a", provider: "codex", model: "actual-codex-model", prompt: "논문의 핵심 근거를 설명해줘", requestId });
}

describe.skipIf(!enabled)("local connector durable database lifecycle", () => {
  beforeEach(async () => {
    process.env.AUTH_SECRET = "isolated-local-agent-test-secret";
    await prisma.paper.deleteMany({ where: { id: { in: ["la-test-paper-a", "la-test-paper-b"] } } });
    await prisma.team.deleteMany({ where: { id: { in: ["la-test-a", "la-test-b"] } } });
    for (const id of ["la-test-ha", "la-test-bob"]) await prisma.member.upsert({ where: { id }, create: { id, name: id, handle: `@${id}`, email: `${id}@test.invalid`, role: "멤버", color: "var(--m-ha)", initial: "하" }, update: {} });
    for (const id of ["la-test-a", "la-test-b"]) await prisma.team.create({ data: { id, slug: id, name: id, createdBy: "la-test-ha", memberships: { create: { memberId: "la-test-ha", role: "owner" } } } });
    await prisma.membership.create({ data: { teamId: "la-test-b", memberId: "la-test-bob", role: "member" } });
    for (const [id, teamId] of [["la-test-paper-a", "la-test-a"], ["la-test-paper-b", "la-test-b"]]) await prisma.paper.create({ data: { id, teamId, title: `Paper ${id}`, authors: "Researcher", abstract: "논문 초록", pdfUrl: "papers/private-object.pdf", uploadedBy: "la-test-ha", tags: [], analysisStatus: "ready", analyses: { create: { lens: "research", payload: { problem: "실험으로 검증한 연구 문제" } } } } });
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => { if (enabled) await prisma.$disconnect(); });

  it("starts a fresh five-minute code deadline at the first desktop ACK", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = new Date("2026-10-18T02:00:00.000Z");
    vi.setSystemTime(started);
    const s = scope();
    const attempt = await createAttempt(s);
    expect(attempt.status).toBe("awaiting_app");
    expect(attempt.expiresAt).toBe(new Date(started.getTime() + 5 * 60_000).toISOString());
    vi.setSystemTime(started.getTime() + 4 * 60_000);
    const ack = await acknowledgeDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" });
    expect(ack.status).toBe("awaiting_code");
    expect(ack.expiresAt).toBe(new Date(started.getTime() + 9 * 60_000).toISOString());
    expect("code" in ack).toBe(false);
    expect(await getAttempt(s, attempt.id)).toMatchObject({ status: "awaiting_code", expiresAt: ack.expiresAt, code: attempt.code });
    vi.setSystemTime(started.getTime() + 6 * 60_000);
    expect((await pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: key, code: attempt.code ?? "" })).status).toBe("connected");
  });

  it("caps the code deadline at the web session and rejects its exact expiry boundary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = new Date("2026-10-18T02:00:00.000Z");
    vi.setSystemTime(started);
    const s = { ...scope(), sessionExpiresAt: new Date(started.getTime() + 6 * 60_000) };
    const attempt = await createAttempt(s);
    vi.setSystemTime(started.getTime() + 4 * 60_000);
    const input = { attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" as const };
    const ack = await acknowledgeDesktop(input);
    expect(ack.expiresAt).toBe(s.sessionExpiresAt.toISOString());
    vi.setSystemTime(s.sessionExpiresAt);
    await expect(acknowledgeDesktop(input)).rejects.toMatchObject({ status: 410, code: "PAIRING_EXPIRED" });
    await expect(pairDesktop({ ...input, code: attempt.code ?? "" })).rejects.toMatchObject({ status: 410 });
    expect(await getAttempt(s, attempt.id)).toMatchObject({ status: "expired", code: null });
  });

  it("keeps the unopened launch deadline at five minutes without allowing a late ACK", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = new Date("2026-10-18T02:00:00.000Z");
    vi.setSystemTime(started);
    const s = scope();
    const attempt = await createAttempt(s);
    vi.setSystemTime(started.getTime() + 5 * 60_000);
    await expect(acknowledgeDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" })).rejects.toMatchObject({ status: 410, code: "PAIRING_EXPIRED" });
    expect(await getAttempt(s, attempt.id)).toMatchObject({ status: "expired", expiresAt: attempt.expiresAt });
    expect((await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).version).toBe(0);
  });

  it("keeps repeated ACKs idempotent without resetting wrong-code failures or the fixed deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = new Date("2026-10-18T02:00:00.000Z");
    vi.setSystemTime(started);
    const s = scope();
    const attempt = await createAttempt(s);
    vi.setSystemTime(started.getTime() + 60_000);
    const input = { attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: key, deviceName: "Original PC", platform: "windows" as const };
    const first = await acknowledgeDesktop(input);
    const wrong = attempt.code === "000000" ? "111111" : "000000";
    await expect(pairDesktop({ ...input, code: wrong })).rejects.toMatchObject({ code: "WRONG_CODE" });
    const failed = await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    vi.setSystemTime(started.getTime() + 2 * 60_000);
    const retried = await acknowledgeDesktop({ ...input, deviceName: "Changed PC" });
    expect(retried.expiresAt).toBe(first.expiresAt);
    expect(retried.version).toBe(failed.version);
    expect(await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ failedAttempts: 1, pendingName: "Original PC", expiresAt: failed.expiresAt, version: failed.version });
    vi.setSystemTime(first.expiresAt);
    await expect(acknowledgeDesktop(input)).rejects.toMatchObject({ status: 410, code: "PAIRING_EXPIRED" });
    expect(await getAttempt(s, attempt.id)).toMatchObject({ status: "expired", code: null });
  });

  it("accepts concurrent ACK retries for the same key as one first acknowledgement", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = new Date("2026-10-18T02:00:00.000Z");
    vi.setSystemTime(started);
    const attempt = await createAttempt(scope());
    vi.setSystemTime(started.getTime() + 4 * 60_000);
    const input = { attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" as const };
    const results = await Promise.all([acknowledgeDesktop(input), acknowledgeDesktop(input)]);
    expect(results[0]).toEqual(results[1]);
    const saved = await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(saved).toMatchObject({ version: 1, failedAttempts: 0, status: "awaiting_code", expiresAt: new Date(started.getTime() + 9 * 60_000) });
  });

  it("rejects another key when two desktops concurrently acknowledge one attempt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T02:00:00.000Z"));
    const attempt = await createAttempt(scope());
    const input = { attemptId: attempt.id, launchToken: attempt.launchToken, deviceName: "PC", platform: "windows" as const };
    const results = await Promise.allSettled([acknowledgeDesktop({ ...input, deviceToken: key }), acknowledgeDesktop({ ...input, deviceToken: otherKey })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ status: 409, code: "ANOTHER_CONNECTOR" });
    expect((await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).version).toBe(1);
  });

  it("commits five wrong-code attempts, then refuses the correct code without registering a device", async () => {
    const attempt = await createAttempt(scope());
    await acknowledgeDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" });
    const wrong = attempt.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await expect(pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: key, code: wrong })).rejects.toMatchObject({ status: i === 4 ? 410 : 400 });
    expect((await prisma.localAgentAttempt.findUnique({ where: { id: attempt.id } }))?.failedAttempts).toBe(5);
    await expect(pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: key, code: attempt.code ?? "" })).rejects.toMatchObject({ status: 410 });
    expect(await prisma.localAgentDevice.count()).toBe(0);
    expect(await prisma.localAgentGrant.count()).toBe(0);
  });

  it("invalidates late ACKs and correct codes after cancellation, replacement and expiry", async () => {
    const first = await createAttempt(scope());
    await cancelAttempt(scope(), first.id);
    await expect(acknowledgeDesktop({ attemptId: first.id, launchToken: first.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" })).rejects.toMatchObject({ status: 410 });
    const second = await createAttempt(scope());
    const third = await createAttempt(scope());
    expect((await getAttempt(scope(), second.id)).status).toBe("cancelled");
    await prisma.localAgentAttempt.update({ where: { id: third.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    await expect(acknowledgeDesktop({ attemptId: third.id, launchToken: third.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" })).rejects.toMatchObject({ status: 410 });
  });

  it("consumes a code once and auto-resumes only the same device, web session and team", async () => {
    const { attempt, identity } = await pair();
    await expect(pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: key, code: attempt.code ?? "" })).rejects.toMatchObject({ status: 409 });
    const resumed = await createAttempt(scope());
    expect((await acknowledgeDesktop({ attemptId: resumed.id, launchToken: resumed.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" })).status).toBe("connected");
    const newSession = { ...scope(), sessionKey: "new-web-session" };
    const reauth = await createAttempt(newSession);
    expect((await acknowledgeDesktop({ attemptId: reauth.id, launchToken: reauth.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" })).status).toBe("awaiting_code");
    await expect(renewWebPermission(newSession, identity.deviceId)).rejects.toMatchObject({ status: 403 });
    expect((await getStatus(scope())).device).toBeNull();
  });

  it("keeps credentials and other teams from reading or mutating this device", async () => {
    const { identity, attempt } = await pair();
    await expect(desktopHeartbeat({ ...identity, deviceToken: otherKey }, [snapshot()])).rejects.toMatchObject({ status: 401 });
    await expect(getAttempt({ ...scope(), teamId: "la-test-b" }, attempt.id)).rejects.toMatchObject({ status: 404 });
    expect((await getStatus({ ...scope(), teamId: "la-test-b" }, identity.deviceId)).device).toBeNull();
    await expect(revokeDevice({ ...scope(), memberId: "la-test-bob", teamId: "la-test-b" }, identity.deviceId)).rejects.toMatchObject({ status: 404 });
  });

  it("persists actual bridge metadata independently of an empty provider catalogue", async () => {
    const { identity, attempt } = await pair();
    expect((await getStatus(scope(), identity.deviceId)).device).toMatchObject({ bridgeVersion: null, bridgeArchitecture: null });
    await desktopHeartbeat(identity, [], { bridgeVersion: "0.1.5-preview.1", bridgeArchitecture: "arm64" });
    const expected = { online: true, bridgeVersion: "0.1.5-preview.1", bridgeArchitecture: "arm64", providers: [] };
    expect((await getStatus(scope(), identity.deviceId)).device).toMatchObject(expected);
    expect((await getAttempt(scope(), attempt.id)).device).toMatchObject(expected);
    expect((await getStatus({ ...scope(), sessionKey: "another-session" }, identity.deviceId)).device).toBeNull();
  });

  it("clears a previous app report when an older app omits metadata while preserving actual CLI capabilities", async () => {
    const { identity } = await pair();
    const ready = snapshot({ models: [{ id: "actual-codex-model", name: "Actual Codex model", reasoningEfforts: ["low", "high"] }], quota: { short: { label: "5h", remainingPercent: 62, resetsAt: null }, weekly: null } });
    await desktopHeartbeat(identity, [ready], { bridgeVersion: "0.1.5", bridgeArchitecture: "x64" });
    await desktopHeartbeat(identity, [ready]);
    expect((await getStatus(scope(), identity.deviceId)).device).toMatchObject({ bridgeVersion: null, bridgeArchitecture: null, providers: [ready] });
    expect((await job(identity.deviceId)).status).toBe("queued");
  });

  it("hides the app report exactly when its desktop heartbeat becomes stale or its web permission expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-10-18T12:00:00.000Z");
    const { identity } = await pair();
    const metadata = { bridgeVersion: "0.1.5", bridgeArchitecture: "x64" as const };
    await desktopHeartbeat(identity, [], metadata);
    vi.setSystemTime(Date.now() + 20_000);
    expect((await getStatus(scope(), identity.deviceId)).device).toMatchObject({ online: false, bridgeVersion: null, bridgeArchitecture: null });
    await desktopHeartbeat(identity, [], metadata);
    expect((await getStatus(scope(), identity.deviceId)).device).toMatchObject({ online: true, ...metadata });
    await prisma.localAgentGrant.updateMany({ where: { deviceId: identity.deviceId }, data: { leaseExpiresAt: new Date() } });
    expect((await getStatus(scope(), identity.deviceId)).device).toMatchObject({ online: false, bridgeVersion: null, bridgeArchitecture: null });
    await expect(desktopHeartbeat(identity, [], metadata)).rejects.toMatchObject({ status: 403 });
  });

  it("queues only actual advertised models and paper context scoped by the server, idempotently", async () => {
    const { identity } = await pair();
    await desktopHeartbeat(identity, [snapshot()]);
    const requestId = crypto.randomUUID();
    const created = await job(identity.deviceId, requestId);
    const repeated = await job(identity.deviceId, requestId);
    expect(repeated.id).toBe(created.id);
    expect(await prisma.localAgentJob.count()).toBe(1);
    await expect(createJob(scope(), { deviceId: identity.deviceId, paperId: "la-test-paper-b", provider: "codex", model: "actual-codex-model", prompt: "다른 팀", requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 404 });
    await expect(createJob(scope(), { deviceId: identity.deviceId, paperId: "la-test-paper-a", provider: "codex", model: "unadvertised", prompt: "질문", requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    const claimed = await claimJob(identity);
    expect(claimed?.job.id).toBe(created.id);
    expect(claimed?.context).toContain("논문 초록");
    expect(claimed?.context).not.toContain("private-object.pdf");
    expect(await claimJob(identity)).toBeNull();
  });

  it("accepts ordered accumulated answers, ignores duplicate events and rejects writes after cancellation", async () => {
    const { identity } = await pair();
    await desktopHeartbeat(identity, [snapshot()]);
    const created = await job(identity.deviceId);
    const claim = await claimJob(identity);
    if (!claim) throw new Error("missing claim");
    await submitResult(identity, { jobId: created.id, claimToken: claim.claimToken, sequence: 2, status: "running", response: "두 번째 응답" });
    await submitResult(identity, { jobId: created.id, claimToken: claim.claimToken, sequence: 1, status: "running", response: "오래된 응답" });
    expect((await getJob(scope(), created.id)).response).toBe("두 번째 응답");
    await cancelJob(scope(), created.id);
    await expect(submitResult(identity, { jobId: created.id, claimToken: claim.claimToken, sequence: 3, status: "completed", response: "늦은 완료" })).rejects.toMatchObject({ code: "JOB_CANCELLED" });
  });

  it("blocks claims and result writes at lease expiry; a desktop heartbeat cannot extend the lease", async () => {
    const { identity } = await pair();
    await desktopHeartbeat(identity, [snapshot()]);
    const created = await job(identity.deviceId);
    const claim = await claimJob(identity);
    if (!claim) throw new Error("missing claim");
    const expired = new Date(Date.now() - 1);
    await prisma.localAgentGrant.updateMany({ where: { deviceId: identity.deviceId }, data: { leaseExpiresAt: expired } });
    await expect(desktopHeartbeat(identity, [snapshot()])).rejects.toMatchObject({ status: 403 });
    await expect(claimJob(identity)).rejects.toMatchObject({ status: 403 });
    await expect(submitResult(identity, { jobId: created.id, claimToken: claim.claimToken, sequence: 1, status: "completed", response: "늦은 결과" })).rejects.toMatchObject({ status: 403 });
    expect((await prisma.localAgentGrant.findFirst({ where: { deviceId: identity.deviceId } }))?.leaseExpiresAt.getTime()).toBe(expired.getTime());
  });

  it("revokes queued/running work on logout and never permits the old session to renew it", async () => {
    const { identity } = await pair();
    const metadata = { bridgeVersion: "0.1.5", bridgeArchitecture: "x64" as const };
    await desktopHeartbeat(identity, [snapshot()], metadata);
    expect((await getStatus(scope(), identity.deviceId)).device).toMatchObject(metadata);
    const created = await job(identity.deviceId);
    const claim = await claimJob(identity);
    if (!claim) throw new Error("missing claim");
    await revokeSession(scope().sessionKey);
    expect((await getStatus(scope(), identity.deviceId)).device).toBeNull();
    await expect(desktopHeartbeat(identity, [snapshot()], metadata)).rejects.toMatchObject({ status: 403 });
    await expect(renewWebPermission(scope(), identity.deviceId)).rejects.toMatchObject({ status: 403 });
    await expect(claimJob(identity)).rejects.toMatchObject({ status: 403 });
    await expect(submitResult(identity, { jobId: created.id, claimToken: claim.claimToken, sequence: 1, status: "completed", response: "회수 후 응답" })).rejects.toMatchObject({ status: 403 });
    const stored = await prisma.localAgentJob.findUnique({ where: { id: created.id } });
    expect(stored?.status).toBe("cancelled");
    expect(stored?.response).toBe("");
  });

  it("clears models/quota on provider logout, preserves unknown usage and blocks stale catalogues", async () => {
    const { identity } = await pair();
    await desktopHeartbeat(identity, [snapshot()]);
    expect((await getStatus(scope(), identity.deviceId)).device?.providers[0].quota).toBeNull();
    const pending = await job(identity.deviceId);
    await desktopHeartbeat(identity, [snapshot({ status: "login_required", quota: { short: { label: "5h", remainingPercent: 62, resetsAt: null }, weekly: null } })]);
    const loggedOut = (await getStatus(scope(), identity.deviceId)).device?.providers[0];
    expect(loggedOut?.models).toEqual([]);
    expect(loggedOut?.quota).toBeNull();
    expect((await getJob(scope(), pending.id)).status).toBe("cancelled");
    await expect(job(identity.deviceId)).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    await prisma.localAgentSnapshot.deleteMany({ where: { deviceId: identity.deviceId } });
    await desktopHeartbeat(identity, [snapshot({ observedAt: new Date(Date.now() - 91_000).toISOString() })]);
    await expect(job(identity.deviceId)).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });

  it("stops a removed team member and revokes a device without leaving quota data", async () => {
    const { identity } = await pair();
    await desktopHeartbeat(identity, [snapshot()]);
    await revokeDevice(scope(), identity.deviceId);
    await expect(desktopHeartbeat(identity, [snapshot()])).rejects.toMatchObject({ status: 401 });
    expect(await prisma.localAgentSnapshot.count({ where: { deviceId: identity.deviceId } })).toBe(0);
    const second = await pair(scope(), otherKey);
    await prisma.membership.delete({ where: { teamId_memberId: { teamId: scope().teamId, memberId: scope().memberId } } });
    await expect(desktopHeartbeat(second.identity, [snapshot()])).rejects.toMatchObject({ status: 403 });
    await expect(getStatus(scope())).rejects.toMatchObject({ status: 403 });
  });

  it("retires a queued removed model so the other provider can answer immediately", async () => {
    const { identity } = await pair();
    const claude = snapshot({ provider: "claude", models: [{ id: "actual-sonnet", name: "Sonnet" }] });
    await desktopHeartbeat(identity, [snapshot(), claude]);
    const obsolete = await job(identity.deviceId);
    const next = await createJob(scope(), { deviceId: identity.deviceId, paperId: "la-test-paper-a", provider: "claude", model: "actual-sonnet", prompt: "다른 AI로 설명해줘", requestId: crypto.randomUUID() });
    await desktopHeartbeat(identity, [snapshot({ models: [{ id: "replacement-model", name: "Replacement" }] }), claude]);
    expect((await getJob(scope(), obsolete.id)).status).toBe("cancelled");
    expect((await claimJob(identity))?.job.id).toBe(next.id);
  });

  it("removal and rejoin never resurrect old device, pending attempt or job permissions", async () => {
    const bob = { ...scope(), teamId: "la-test-b", memberId: "la-test-bob", sessionKey: "bob-web-session" };
    const { identity } = await pair(bob);
    await desktopHeartbeat(identity, [snapshot()]);
    const pendingJob = await createJob(bob, { deviceId: identity.deviceId, paperId: "la-test-paper-b", provider: "codex", model: "actual-codex-model", prompt: "재가입 전 질문", requestId: crypto.randomUUID() });
    const pendingAttempt = await createAttempt(bob);
    const { DELETE } = await import("@/app/api/teams/[slug]/members/[memberId]/route");
    const removed = await DELETE(new Request("http://localhost/api/teams/la-test-b/members/la-test-bob", { method: "DELETE" }), { params: Promise.resolve({ slug: "la-test-b", memberId: "la-test-bob" }) });
    expect(removed.status).toBe(200);
    await prisma.membership.create({ data: { teamId: bob.teamId, memberId: bob.memberId, role: "member" } });
    expect((await getStatus(bob)).devices).toEqual([]);
    await expect(desktopHeartbeat(identity, [snapshot()])).rejects.toMatchObject({ status: 401 });
    await expect(renewWebPermission(bob, identity.deviceId)).rejects.toMatchObject({ status: 403 });
    await expect(acknowledgeDesktop({ attemptId: pendingAttempt.id, launchToken: pendingAttempt.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" })).rejects.toMatchObject({ status: 410 });
    expect((await getJob(bob, pendingJob.id)).status).toBe("cancelled");
    const fresh = await createAttempt(bob);
    expect((await acknowledgeDesktop({ attemptId: fresh.id, launchToken: fresh.launchToken, deviceToken: key, deviceName: "PC", platform: "windows" })).status).toBe("awaiting_code");
  });

  it("skips a queued job whose catalogue became stale while another provider stayed fresh", async () => {
    const { identity } = await pair();
    await desktopHeartbeat(identity, [snapshot(), snapshot({ provider: "claude", models: [{ id: "sonnet", name: "Sonnet" }] })]);
    const obsolete = await job(identity.deviceId);
    const next = await createJob(scope(), { deviceId: identity.deviceId, paperId: "la-test-paper-a", provider: "claude", model: "sonnet", prompt: "새 모델의 질문", requestId: crypto.randomUUID() });
    await prisma.localAgentSnapshot.update({ where: { deviceId_provider: { deviceId: identity.deviceId, provider: "codex" } }, data: { observedAt: new Date(Date.now() - 91_000) } });
    expect((await claimJob(identity))?.job.id).toBe(next.id);
    expect((await getJob(scope(), obsolete.id)).status).toBe("cancelled");
  });

  it("deduplicates simultaneous requests and enforces the last queue slot on the real isolated database", async () => {
    const { identity } = await pair();
    await desktopHeartbeat(identity, [snapshot()]);
    const requestId = crypto.randomUUID();
    const duplicate = await Promise.all([job(identity.deviceId, requestId), job(identity.deviceId, requestId)]);
    expect(duplicate[0].id).toBe(duplicate[1].id);
    expect(await prisma.localAgentJob.count()).toBe(1);
    await Promise.all(Array.from({ length: 3 }, () => job(identity.deviceId)));
    const lastSlot = await Promise.allSettled([job(identity.deviceId), job(identity.deviceId)]);
    expect(lastSlot.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = lastSlot.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ status: 429, code: "QUEUE_FULL" });
    expect(await prisma.localAgentJob.count({ where: { status: { in: ["queued", "running"] } } })).toBe(5);
  });
});
