// @vitest-environment node
// Real PostgreSQL 16 coverage, exclusively through scripts/local-agent-pg-verify.mjs.
// Default suites skip this file. CI gates and the exact dedicated datasource are
// checked again before the independently generated client is instantiated.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient as ApplicationPrismaClient } from "@prisma/client";
interface QueryEvent { model: string; operation: string; args: unknown }
const queryHooks = vi.hoisted(() => {
  const hooks: { before?: (event: QueryEvent) => Promise<void>; after?: (event: QueryEvent) => Promise<void> } = {};
  return hooks;
});
const effects = vi.hoisted(() => ({ send: vi.fn(), download: vi.fn(), render: vi.fn() }));
vi.mock("@/lib/inngest", () => ({ inngest: { send: effects.send } }));
vi.mock("@/lib/storage", () => ({ signedDownloadUrl: effects.download }));
vi.mock("@/lib/figure-render", () => ({ renderFigures: effects.render }));
vi.mock("@/lib/prisma", async () => {
  const clientModule = process.env.LOCAL_AGENT_PG_TEST_CLIENT_MODULE;
  if (!clientModule && process.env.HAPARK_PG_ISOLATED_TESTS !== "1") return { prisma: {} };
  if (!clientModule) throw new Error("Run the guarded PostgreSQL verifier to generate an isolated test client.");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const verifier = require("../../../scripts/local-agent-pg-verify.mjs");
  const url = verifier.assertIsolatedPostgres(process.env);
  const { isAbsolute } = await import("node:path");
  if (!isAbsolute(clientModule)) throw new Error("The isolated PostgreSQL client path must be absolute.");
  const { PrismaClient } = require(clientModule);
  const client: ApplicationPrismaClient = new PrismaClient({ datasources: { db: { url } } });
  return { prisma: client.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
    const event = { model, operation, args };
    await queryHooks.before?.(event);
    const result = await query(args);
    await queryHooks.after?.(event);
    return result;
  } } } }) };
});
vi.mock("@/lib/auth", () => ({ requireAuth: async () => ({ memberId: "la-pg-owner", role: "관리자" }) }));
import { prisma } from "@/lib/prisma";
import { acknowledgeDesktop, claimJob, createAttempt, createJob, desktopHeartbeat, getStatus, pairDesktop, renewWebPermission, revokeSession, submitResult, type LocalAgentScope } from "../service";
import type { LocalAgentProviderSnapshot } from "@/types/local-agent";
import { cancelTurn, createConversation, createTurn } from "@/lib/research-chat/service";
import { finishAnalysisRun, prepareAnalysisRun, requestLocalAnalysis } from "@/lib/local-ai/service";
import { parsePaperSource } from "@/lib/local-ai/source";
import { beginChatPreparation, finishChatPreparation } from "@/lib/research-chat/preparation";
import { hashCredential } from "../security";

const enabled = Boolean(process.env.LOCAL_AGENT_PG_TEST_CLIENT_MODULE || process.env.HAPARK_PG_ISOLATED_TESTS === "1");
const scope = (): LocalAgentScope => ({ memberId: "la-pg-owner", teamId: "la-pg-a", sessionKey: "pg-owner-session", sessionExpiresAt: new Date(Date.now() + 3_600_000) });
const snapshot = (overrides: Partial<LocalAgentProviderSnapshot> = {}): LocalAgentProviderSnapshot => ({ provider: "codex", status: "ready", models: [{ id: "actual-model", name: "Actual model" }], quota: null, observedAt: new Date().toISOString(), ...overrides });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((accept) => { resolve = accept; }); return { promise, resolve }; }
async function bounded(promise: Promise<unknown>, description: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`PostgreSQL race barrier timed out: ${description}`)), 3000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function whereOf(event: QueryEvent): Record<string, unknown> {
  if (event.args && typeof event.args === "object" && "where" in event.args && event.args.where && typeof event.args.where === "object") return event.args.where as Record<string, unknown>;
  return {};
}
async function start(s = scope()) {
  const attempt = await createAttempt(s);
  const deviceToken = randomBytes(32).toString("base64url");
  await acknowledgeDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, deviceName: "CI test PC", platform: "linux" });
  return { attempt, deviceToken };
}
async function paired(s = scope()) {
  const { attempt, deviceToken } = await start(s);
  const result = await pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, code: attempt.code ?? "" });
  if (!result.deviceId) throw new Error("Isolated fixture pairing failed.");
  const identity = { deviceId: result.deviceId, deviceToken };
  await desktopHeartbeat(identity, [snapshot()]);
  return { attempt, identity };
}
async function question(deviceId: string, requestId = randomUUID(), s = scope()) {
  return createJob(s, { deviceId, paperId: s.teamId === "la-pg-b" ? "la-pg-paper-b" : "la-pg-paper-a", provider: "codex", model: "actual-model", prompt: "이 격리 논문을 설명해줘", requestId });
}
async function cleanFixtures() {
  // Job has no Team FK. Delete only this suite's local-analysis runs, including
  // any request superseded by a later fixture run; never another job type/team.
  await prisma.job.deleteMany({ where: { type: "prepare_local_analysis", OR: [
    { payload: { path: ["scope", "teamId"], equals: "la-pg-a" } },
    { payload: { path: ["scope", "teamId"], equals: "la-pg-b" } },
  ] } });
  await prisma.paper.deleteMany({ where: { id: { startsWith: "la-pg-" } } });
  await prisma.presentation.deleteMany({ where: { id: { startsWith: "la-pg-" } } });
  await prisma.team.deleteMany({ where: { id: { startsWith: "la-pg-" } } });
  await prisma.member.deleteMany({ where: { id: { startsWith: "la-pg-" } } });
}

describe.skipIf(!enabled)("real isolated PostgreSQL 16 concurrency", () => {
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<{ name: string; version: string; isolation: string }[]>`SELECT current_database() AS name, current_setting('server_version_num') AS version, current_setting('transaction_isolation') AS isolation`;
    expect(rows[0].name).toBe("hapark_local_agent_test");
    expect(Number(rows[0].version)).toBeGreaterThanOrEqual(160000);
    expect(Number(rows[0].version)).toBeLessThan(170000);
    expect(rows[0].isolation).toBe("read committed");
  });
  beforeEach(async () => {
    queryHooks.before = undefined; queryHooks.after = undefined;
    effects.send.mockReset().mockResolvedValue({ ids: ["isolated-event"] });
    effects.download.mockReset().mockRejectedValue(new Error("Unexpected external PDF access."));
    effects.render.mockReset().mockRejectedValue(new Error("Unexpected figure rendering."));
    await cleanFixtures();
    for (const id of ["la-pg-owner", "la-pg-member"]) await prisma.member.create({ data: { id, name: id, email: `${id}@test.invalid`, handle: `@${id}`, role: "멤버", color: "var(--m-ha)", initial: "하" } });
    for (const id of ["la-pg-a", "la-pg-b"]) await prisma.team.create({ data: { id, slug: id, name: id, createdBy: "la-pg-owner", memberships: { create: { memberId: "la-pg-owner", role: "owner" } } } });
    await prisma.membership.create({ data: { teamId: "la-pg-b", memberId: "la-pg-member", role: "member" } });
    for (const suffix of ["a", "b"]) await prisma.paper.create({ data: { id: `la-pg-paper-${suffix}`, teamId: `la-pg-${suffix}`, title: "Disposable concurrency fixture", authors: "CI", abstract: "No external paper data", pdfUrl: "fixture.pdf", uploadedBy: "la-pg-owner", tags: [], analysisStatus: "ready", sourceText: JSON.stringify([{ page: 1, text: "Synthetic source text for isolated conversation concurrency. No private paper data." }]), sourceDigest: "a".repeat(64) } });
  });
  afterAll(async () => { queryHooks.before = undefined; queryHooks.after = undefined; await cleanFixtures(); await prisma.$disconnect(); });

  it("fixes one five-minute first-ACK deadline across simultaneous same-key retries", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = new Date("2026-10-18T02:00:00.000Z");
    try {
      vi.setSystemTime(started);
      const attempt = await createAttempt(scope());
      const deviceToken = randomBytes(32).toString("base64url");
      const input = { attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, deviceName: "CI first ACK PC", platform: "linux" as const };
      vi.setSystemTime(started.getTime() + 4 * 60_000);
      const bothRead = deferred();
      let reads = 0;
      queryHooks.after = async (event) => {
        if (event.model === "LocalAgentAttempt" && event.operation === "findUnique" && whereOf(event).id === attempt.id && reads < 2) {
          if (++reads === 2) bothRead.resolve();
          await bounded(bothRead.promise, "both same-key ACKs read the unopened attempt");
        }
      };
      const results = await Promise.all([acknowledgeDesktop(input), acknowledgeDesktop(input)]);
      queryHooks.after = undefined;
      const deadline = new Date(started.getTime() + 9 * 60_000);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toMatchObject({ status: "awaiting_code", version: 1, expiresAt: deadline.toISOString() });
      expect(await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ status: "awaiting_code", version: 1, failedAttempts: 0, expiresAt: deadline, pendingSecretHash: hashCredential(deviceToken) });
      vi.setSystemTime(started.getTime() + 4 * 60_000 + 30_000);
      expect(await acknowledgeDesktop(input)).toEqual(results[0]);
      expect((await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).version).toBe(1);
    } finally { queryHooks.after = undefined; vi.useRealTimers(); }
  }, 30_000);

  it("preserves the winning key and rejects a concurrent different-key ACK after rereading", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = new Date("2026-10-18T02:00:00.000Z");
    try {
      vi.setSystemTime(started);
      const attempt = await createAttempt(scope());
      const firstKey = randomBytes(32).toString("base64url"), secondKey = randomBytes(32).toString("base64url");
      const input = { attemptId: attempt.id, launchToken: attempt.launchToken, deviceName: "CI concurrent ACK PC", platform: "linux" as const };
      vi.setSystemTime(started.getTime() + 4 * 60_000);
      const bothRead = deferred();
      let reads = 0;
      queryHooks.after = async (event) => {
        if (event.model === "LocalAgentAttempt" && event.operation === "findUnique" && whereOf(event).id === attempt.id && reads < 2) {
          if (++reads === 2) bothRead.resolve();
          await bounded(bothRead.promise, "both different-key ACKs read the unopened attempt");
        }
      };
      const results = await Promise.allSettled([acknowledgeDesktop({ ...input, deviceToken: firstKey }), acknowledgeDesktop({ ...input, deviceToken: secondKey })]);
      queryHooks.after = undefined;
      expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
      for (const entry of results) if (entry.status === "rejected") expect(entry.reason).toMatchObject({ status: 409, code: "ANOTHER_CONNECTOR" });
      const winnerKey = results[0].status === "fulfilled" ? firstKey : secondKey;
      const saved = await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(saved).toMatchObject({ pendingSecretHash: hashCredential(winnerKey), version: 1, failedAttempts: 0, status: "awaiting_code", expiresAt: new Date(started.getTime() + 9 * 60_000) });
      const losingKey = winnerKey === firstKey ? secondKey : firstKey;
      await expect(acknowledgeDesktop({ ...input, deviceToken: losingKey })).rejects.toMatchObject({ status: 409, code: "ANOTHER_CONNECTOR" });
      expect(await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toEqual(saved);
      expect(await prisma.localAgentDevice.count()).toBe(0);
      expect(await prisma.localAgentGrant.count()).toBe(0);
    } finally { queryHooks.after = undefined; vi.useRealTimers(); }
  }, 30_000);

  it("bounds concurrent wrong-code updates and refuses a correct code after five committed failures", async () => {
    const { attempt, deviceToken } = await start();
    const wrong = attempt.code === "000000" ? "111111" : "000000";
    for (let wave = 0; wave < 5; wave++) {
      const failures = await Promise.allSettled(Array.from({ length: 4 }, () => pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, code: wrong })));
      for (const entry of failures) {
        expect(entry.status).toBe("rejected");
        if (entry.status === "rejected") expect([400, 409, 410]).toContain(entry.reason.status);
      }
      const current = await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(current.failedAttempts).toBeLessThanOrEqual(5);
      if (current.failedAttempts === 5) break;
    }
    expect((await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).failedAttempts).toBe(5);
    await expect(pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, code: attempt.code ?? "" })).rejects.toMatchObject({ status: 410 });
    expect(await prisma.localAgentGrant.count()).toBe(0);
  }, 30_000);

  it("consumes one correct code only once under concurrent confirmation", async () => {
    const { attempt, deviceToken } = await start();
    const input = { attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken, code: attempt.code ?? "" };
    const result = await Promise.allSettled([pairDesktop(input), pairDesktop(input)]);
    expect(result.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    for (const entry of result) if (entry.status === "rejected") expect(entry.reason).toMatchObject({ status: 409 });
    expect(await prisma.localAgentDevice.count()).toBe(1);
    expect(await prisma.localAgentGrant.count()).toBe(1);
    expect((await prisma.localAgentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("connected");
  }, 30_000);

  it("allows only one running claim across simultaneous connector polls", async () => {
    const { identity } = await paired();
    await Promise.all([question(identity.deviceId), question(identity.deviceId)]);
    const claims = await Promise.all([claimJob(identity), claimJob(identity)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await prisma.localAgentJob.count({ where: { status: "running" } })).toBe(1);
    expect(await prisma.localAgentJob.count({ where: { status: "queued" } })).toBe(1);
  }, 30_000);

  it("deduplicates simultaneous request IDs and admits exactly five queued jobs", async () => {
    const { identity } = await paired();
    const requestId = randomUUID();
    const duplicates = await Promise.all(Array.from({ length: 6 }, () => question(identity.deviceId, requestId)));
    expect(new Set(duplicates.map((entry) => entry.id)).size).toBe(1);
    await Promise.all(Array.from({ length: 3 }, () => question(identity.deviceId)));
    const lastSlot = await Promise.allSettled(Array.from({ length: 4 }, () => question(identity.deviceId)));
    expect(lastSlot.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    for (const entry of lastSlot) if (entry.status === "rejected") expect(entry.reason).toMatchObject({ status: 429, code: "QUEUE_FULL" });
    expect(await prisma.localAgentJob.count({ where: { status: { in: ["queued", "running"] } } })).toBe(5);
  }, 30_000);

  it("returns a request-ID conflict rather than a unique-constraint failure across two real device locks", async () => {
    const firstDevice = await paired(), secondDevice = await paired();
    const requestId = randomUUID(), read = deferred(), release = deferred();
    let paused = false;
    queryHooks.after = async (event) => { if (!paused && event.model === "LocalAgentJob" && event.operation === "findUnique") { paused = true; read.resolve(); await release.promise; } };
    const first = question(firstDevice.identity.deviceId, requestId);
    await bounded(read.promise, "first device request-ID lookup");
    const second = question(secondDevice.identity.deviceId, requestId);
    try { await bounded(second, "independent second device commit"); } finally { release.resolve(); }
    const results = await Promise.allSettled([first, second]);
    queryHooks.after = undefined;
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    for (const entry of results) if (entry.status === "rejected") expect(entry.reason).toMatchObject({ status: 409, code: "REQUEST_ID_REUSED" });
    expect(await prisma.localAgentJob.count({ where: { requestId } })).toBe(1);
  }, 30_000);

  it("keeps a newer provider logout when an older heartbeat is paused after its snapshot read", async () => {
    const { identity } = await paired();
    const read = deferred(), release = deferred(), contender = deferred();
    let paused = false;
    queryHooks.after = async (event) => { if (!paused && event.model === "LocalAgentSnapshot" && event.operation === "findUnique") { paused = true; read.resolve(); await release.promise; } };
    queryHooks.before = async (event) => { if (paused && event.model === "LocalAgentDevice" && event.operation.startsWith("update")) contender.resolve(); };
    const old = desktopHeartbeat(identity, [snapshot({ observedAt: new Date().toISOString() })]);
    await bounded(read.promise, "old snapshot read");
    const newer = desktopHeartbeat(identity, [snapshot({ status: "login_required", models: [], observedAt: new Date(Date.now() + 1).toISOString() })]);
    try { await bounded(contender.promise, "second heartbeat row-lock attempt"); } finally { release.resolve(); }
    await Promise.all([old, newer]);
    queryHooks.before = undefined; queryHooks.after = undefined;
    const current = (await getStatus(scope(), identity.deviceId)).device?.providers[0];
    expect(current?.status).toBe("login_required");
    expect(current?.models).toEqual([]);
    expect(current?.quota).toBeNull();
  }, 30_000);

  it("removes permissions atomically while a heartbeat holds the same real device row", async () => {
    const member = { ...scope(), memberId: "la-pg-member", teamId: "la-pg-b", sessionKey: "pg-member-session" };
    const { identity } = await paired(member);
    const pending = await question(identity.deviceId, randomUUID(), member);
    const holding = deferred(), release = deferred(), deletion = deferred();
    let paused = false;
    queryHooks.after = async (event) => { if (!paused && event.model === "LocalAgentDevice" && event.operation === "updateMany" && whereOf(event).id === identity.deviceId) { paused = true; holding.resolve(); await release.promise; } };
    queryHooks.before = async (event) => { if (paused && event.model === "LocalAgentDevice" && event.operation === "updateMany" && whereOf(event).memberId === member.memberId) deletion.resolve(); };
    const heartbeat = desktopHeartbeat(identity, [snapshot()]);
    await bounded(holding.promise, "heartbeat device lock");
    const { DELETE } = await import("@/app/api/teams/[slug]/members/[memberId]/route");
    const removed = DELETE(new Request("http://localhost/api/teams/la-pg-b/members/la-pg-member", { method: "DELETE" }), { params: Promise.resolve({ slug: "la-pg-b", memberId: "la-pg-member" }) });
    try { await bounded(deletion.promise, "membership revocation device lock"); } finally { release.resolve(); }
    await heartbeat;
    expect((await removed).status).toBe(200);
    queryHooks.before = undefined; queryHooks.after = undefined;
    await prisma.membership.create({ data: { memberId: member.memberId, teamId: member.teamId, role: "member" } });
    expect((await getStatus(member)).devices).toEqual([]);
    await expect(desktopHeartbeat(identity, [snapshot()])).rejects.toMatchObject({ status: 401 });
    expect((await prisma.localAgentJob.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("cancelled");
    expect(await prisma.localAgentSnapshot.count({ where: { deviceId: identity.deviceId } })).toBe(0);
  }, 30_000);

  it("cannot renew or write results after logout even when a prior heartbeat overlaps revocation", async () => {
    const { identity } = await paired();
    const queued = await question(identity.deviceId);
    const claim = await claimJob(identity);
    if (!claim) throw new Error("Missing isolated claim.");
    const read = deferred(), release = deferred();
    let paused = false;
    queryHooks.after = async (event) => { if (!paused && event.model === "LocalAgentSnapshot" && event.operation === "findUnique") { paused = true; read.resolve(); await release.promise; } };
    const heartbeat = desktopHeartbeat(identity, [snapshot()]);
    await bounded(read.promise, "heartbeat before logout");
    try { await revokeSession(scope().sessionKey); } finally { release.resolve(); }
    // An already-issued metadata response may complete; it can never mint a new grant.
    await Promise.allSettled([heartbeat]);
    queryHooks.after = undefined;
    expect((await getStatus(scope())).devices).toEqual([]);
    await expect(renewWebPermission(scope(), identity.deviceId)).rejects.toMatchObject({ status: 403 });
    await expect(claimJob(identity)).rejects.toMatchObject({ status: 403 });
    await expect(submitResult(identity, { jobId: queued.id, claimToken: claim.claimToken, sequence: 1, status: "completed", response: "late" })).rejects.toMatchObject({ status: 403 });
  }, 30_000);

  it("serializes one conversation across two independently authorized devices", async () => {
    const firstDevice = await paired(), secondDevice = await paired();
    const thread = await createConversation(scope(), { requestId: randomUUID(), paperIds: ["la-pg-paper-a"] });
    const holding = deferred(), release = deferred(), contender = deferred();
    let paused = false;
    queryHooks.after = async event => { if (!paused && event.model === "ResearchConversation" && event.operation === "updateMany" && whereOf(event).id === thread.id) { paused = true; holding.resolve(); await release.promise; } };
    queryHooks.before = async event => { if (paused && event.model === "ResearchConversation" && event.operation === "updateMany" && whereOf(event).id === thread.id) contender.resolve(); };
    const input = (deviceId: string) => ({ deviceId, requestId: randomUUID(), provider: "codex" as const, model: "actual-model", prompt: "Compare the supplied evidence." });
    const first = createTurn(scope(), thread.id, input(firstDevice.identity.deviceId));
    await bounded(holding.promise, "first conversation row lock");
    const second = createTurn(scope(), thread.id, input(secondDevice.identity.deviceId));
    const settled = Promise.allSettled([first, second]);
    try { await bounded(contender.promise, "second device waiting for conversation row"); } finally { release.resolve(); }
    const results = await settled;
    queryHooks.before = undefined; queryHooks.after = undefined;
    expect(results.filter(entry => entry.status === "fulfilled")).toHaveLength(1);
    for (const entry of results) if (entry.status === "rejected") expect(entry.reason).toMatchObject({ status: 409, code: "CONVERSATION_BUSY" });
    expect(await prisma.localAgentJob.count({ where: { conversationId: thread.id, status: { in: ["queued", "running"] } } })).toBe(1);
  }, 30_000);

  it("deduplicates concurrent conversation retries and rejects a cross-device request-ID race after rollback", async () => {
    const firstDevice = await paired(), secondDevice = await paired();
    const thread = await createConversation(scope(), { requestId: randomUUID(), paperIds: ["la-pg-paper-a"] });
    const input = { deviceId: firstDevice.identity.deviceId, requestId: randomUUID(), provider: "codex" as const, model: "actual-model", prompt: "Explain the supplied evidence." };
    const read = deferred(), release = deferred(), contender = deferred();
    let paused = false;
    queryHooks.after = async event => { if (!paused && event.model === "LocalAgentJob" && event.operation === "findUnique") { paused = true; read.resolve(); await release.promise; } };
    queryHooks.before = async event => { if (paused && event.model === "ResearchConversation" && event.operation === "updateMany") contender.resolve(); };
    const first = createTurn(scope(), thread.id, input);
    await bounded(read.promise, "first conversation request-ID lookup");
    const retry = createTurn(scope(), thread.id, input);
    const duplicates = Promise.all([first, retry]);
    try { await bounded(contender.promise, "identical retry conversation lock"); } finally { release.resolve(); }
    const completed = await duplicates;
    queryHooks.before = undefined; queryHooks.after = undefined;
    expect(completed[0].id).toBe(completed[1].id);
    await cancelTurn(scope(), thread.id, completed[0].id);

    const other = await createConversation(scope(), { requestId: randomUUID(), paperIds: ["la-pg-paper-a"] });
    const crossRead = deferred(), crossRelease = deferred();
    let crossPaused = false;
    queryHooks.after = async event => { if (!crossPaused && event.model === "LocalAgentJob" && event.operation === "findUnique") { crossPaused = true; crossRead.resolve(); await crossRelease.promise; } };
    const requestId = randomUUID();
    const firstAcross = createTurn(scope(), thread.id, { ...input, requestId });
    await bounded(crossRead.promise, "first independent conversation lookup");
    const secondAcross = createTurn(scope(), other.id, { ...input, requestId, deviceId: secondDevice.identity.deviceId });
    const race = Promise.allSettled([firstAcross, secondAcross]);
    try { await bounded(secondAcross, "independent second conversation commit"); } finally { crossRelease.resolve(); }
    const results = await race;
    queryHooks.after = undefined;
    expect(results.filter(entry => entry.status === "fulfilled")).toHaveLength(1);
    for (const entry of results) if (entry.status === "rejected") expect(entry.reason).toMatchObject({ status: 409, code: "REQUEST_ID_REUSED" });
    expect(await prisma.localAgentJob.count({ where: { requestId } })).toBe(1);
  }, 30_000);

  it("returns 409 after the real cross-paper analysis request-ID conflict rolls back", async () => {
    const { identity } = await paired();
    const otherPaper = "la-pg-paper-a-other";
    await prisma.paper.create({ data: { id: otherPaper, teamId: scope().teamId, title: "Second isolated paper", authors: "CI", pdfUrl: "second-fixture.pdf", uploadedBy: scope().memberId, tags: [] } });
    const selection = { deviceId: identity.deviceId, requestId: randomUUID(), provider: "codex" as const, model: "actual-model" };
    const read = deferred(), release = deferred();
    let paused = false;
    // The first transaction owns paper A but has not created its unique Job.
    // Paper B's independent row lock must allow the competing transaction to
    // commit that same Job ID before A resumes and encounters actual P2002.
    queryHooks.after = async event => {
      if (!paused && event.model === "Job" && event.operation === "findUnique") { paused = true; read.resolve(); await release.promise; }
    };
    const first = requestLocalAnalysis(scope(), "la-pg-paper-a", selection);
    await bounded(read.promise, "first analysis request-ID lookup while paper A is locked");
    const second = requestLocalAnalysis(scope(), otherPaper, selection);
    const settled = Promise.allSettled([first, second]);
    try { await bounded(second, "independent paper B analysis commit"); }
    finally { release.resolve(); }
    const results = await settled;
    queryHooks.after = undefined;
    expect(results.filter(entry => entry.status === "fulfilled")).toHaveLength(1);
    for (const entry of results) if (entry.status === "rejected") expect(entry.reason).toMatchObject({ status: 409, code: "REQUEST_ID_REUSED" });
    const winner = results.find(entry => entry.status === "fulfilled");
    if (!winner || winner.status !== "fulfilled") throw new Error("Missing isolated analysis winner.");
    expect(await prisma.job.count({ where: { id: winner.value.runId, type: "prepare_local_analysis" } })).toBe(1);
    expect((await prisma.paper.findUniqueOrThrow({ where: { id: "la-pg-paper-a" } })).analysisRequestId).toBeNull();
    expect((await prisma.paper.findUniqueOrThrow({ where: { id: otherPaper } })).analysisRequestId).toBe(winner.value.runId);
    expect(effects.send).toHaveBeenCalledOnce();
    expect(effects.send).toHaveBeenCalledWith({ name: "paper/analyze", data: { paperId: otherPaper, runId: winner.value.runId } });
    expect(effects.download).not.toHaveBeenCalled(); expect(effects.render).not.toHaveBeenCalled();
    expect(await prisma.localAgentJob.count({ where: { teamId: scope().teamId } })).toBe(0);
  }, 30_000);

  it("merges simultaneous retries for one paper into one analysis run and one event", async () => {
    const { identity } = await paired();
    const selection = { deviceId: identity.deviceId, requestId: randomUUID(), provider: "codex" as const, model: "actual-model" };
    const holding = deferred(), contender = deferred(), release = deferred();
    let paused = false;
    queryHooks.after = async event => {
      if (!paused && event.model === "Paper" && event.operation === "updateMany" && whereOf(event).id === "la-pg-paper-a") { paused = true; holding.resolve(); await release.promise; }
    };
    queryHooks.before = async event => {
      if (paused && event.model === "Paper" && event.operation === "updateMany" && whereOf(event).id === "la-pg-paper-a") contender.resolve();
    };
    const first = requestLocalAnalysis(scope(), "la-pg-paper-a", selection);
    await bounded(holding.promise, "first analysis paper lock");
    const retry = requestLocalAnalysis(scope(), "la-pg-paper-a", selection);
    const settled = Promise.all([first, retry]);
    try { await bounded(contender.promise, "same-paper retry waiting for the existing row lock"); }
    finally { release.resolve(); }
    const results = await settled;
    queryHooks.before = undefined; queryHooks.after = undefined;
    expect(results[0].runId).toBe(results[1].runId);
    expect(await prisma.job.count({ where: { id: results[0].runId, type: "prepare_local_analysis" } })).toBe(1);
    expect(effects.send).toHaveBeenCalledOnce();
    expect(effects.download).not.toHaveBeenCalled(); expect(effects.render).not.toHaveBeenCalled();
    expect(await prisma.localAgentJob.count({ where: { teamId: scope().teamId } })).toBe(0);
  }, 30_000);

  it("holds the seminar parent key lock through queue CAS before allowing its first PDF to be inserted", async () => {
    const { identity } = await paired();
    const seminarId = "la-pg-source-parent";
    await prisma.presentation.create({ data: { id: seminarId, teamId: scope().teamId, presenterId: scope().memberId,
      title: "Synthetic source lock fixture", date: new Date(), tags: [], keypoints: [], slides: [],
      assets: { create: { id: "la-pg-removed-initial-pdf", name: "synthetic.pdf", type: "pdf", size: "100 B", url: "presentations/synthetic-initial.pdf" } } } });
    const thread = await createConversation(scope(), { requestId: randomUUID(), paperIds: [], presentationIds: [seminarId] });
    const pending = await createTurn(scope(), thread.id, { deviceId: identity.deviceId, requestId: randomUUID(), provider: "codex", model: "actual-model", prompt: "Read the synthetic seminar" });
    expect(pending.status).toBe("preparing");
    await prisma.presentationAsset.delete({ where: { id: "la-pg-removed-initial-pdf" } });
    const plan = await beginChatPreparation(pending.id);
    if (!plan) throw new Error("Missing isolated preparation fixture.");
    const holding = deferred(), release = deferred(), insertAttempted = deferred();
    let paused = false, inserted = false;
    queryHooks.after = async event => {
      if (!paused && event.model === "Presentation" && event.operation === "updateMany" && whereOf(event).id === seminarId) {
        paused = true; holding.resolve(); await release.promise;
      }
    };
    queryHooks.before = async event => { if (paused && event.model === "PresentationAsset" && event.operation === "create") insertAttempted.resolve(); };
    const finishing = finishChatPreparation(plan, [{ target: { kind: "presentation", id: seminarId, teamId: scope().teamId }, objectKey: null, assetId: null, source: null }]);
    const finished = Promise.allSettled([finishing]);
    await bounded(holding.promise, "preparation owning the seminar parent key lock");
    const inserting = prisma.presentationAsset.create({ data: { id: "la-pg-new-first-pdf", presentationId: seminarId, name: "synthetic-new.pdf", type: "pdf", size: "100 B", url: "presentations/synthetic-new.pdf" } }).then(result => { inserted = true; return result; });
    let blocked = false;
    let completed: Awaited<typeof finished> = [];
    try {
      await bounded(insertAttempted.promise, "first PDF FK insert attempted while parent is locked");
      await new Promise(resolve => setTimeout(resolve, 100));
      blocked = !inserted;
    } finally {
      release.resolve();
      completed = await finished;
      await inserting;
      queryHooks.before = undefined; queryHooks.after = undefined;
    }
    expect(blocked).toBe(true);
    expect(completed[0].status).toBe("fulfilled");
    expect(inserted).toBe(true);
    const stored = await prisma.localAgentJob.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored.status).toBe("queued");
    expect(JSON.parse(stored.context).presentations[0].pages).toEqual([]);
    expect(effects.download).not.toHaveBeenCalled(); expect(effects.render).not.toHaveBeenCalled();
  }, 30_000);

  it("lets member removal commit while completion holds the paper lock and rechecks membership before storing", async () => {
    const member = { ...scope(), memberId: "la-pg-member", teamId: "la-pg-b", sessionKey: "pg-analysis-member" };
    const { identity } = await paired(member);
    const run = await requestLocalAnalysis(member, "la-pg-paper-b", { deviceId: identity.deviceId, requestId: randomUUID(), provider: "codex", model: "actual-model" });
    const cached = await prisma.paper.findUniqueOrThrow({ where: { id: "la-pg-paper-b" }, select: { sourceText: true, sourceDigest: true } });
    expect(cached.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(parsePaperSource(cached.sourceText ?? "")).toEqual([{ page: 1, text: "Synthetic source text for isolated conversation concurrency. No private paper data." }]);
    await prepareAnalysisRun(run.runId);
    const claimed = await claimJob(identity);
    if (!claimed) throw new Error("Missing isolated analysis claim.");
    const table = { caption: "", columns: [], rows: [] };
    const result = JSON.stringify({
      research: { problem: { oneLine: "Synthetic fixture", setting: "", assumptions: [] }, contributions: [], io: { inputs: [], outputs: [] }, comparison: table, ablation: table },
      repro: { data: table, model: { params: "", items: [] }, loss: [], metrics: [], training: { caption: "", rows: [] }, gpu: { hardware: "", count: 0, vramGb: 0, vramUsedGb: 0, trainDays: 0, note: "" }, repo: { found: false, url: null, summary: "", tree: [], source: "paper" }, diagram: { nodes: [], edges: [] } },
      figures: [], references: ["research", "repro"].map(lens => ({ lens, sourcePage: 1, quote: "Synthetic source text for isolated conversation concurrency." })),
    });
    await submitResult(identity, { jobId: claimed.job.id, claimToken: claimed.claimToken, sequence: 1, status: "completed", response: result });
    const holding = deferred(), deletion = deferred(), release = deferred();
    let paused = false;
    queryHooks.after = async event => {
      if (!paused && event.model === "Paper" && event.operation === "updateMany" && whereOf(event).id === "la-pg-paper-b") { paused = true; holding.resolve(); await release.promise; }
    };
    queryHooks.before = async event => { if (paused && event.model === "Membership" && event.operation === "delete") deletion.resolve(); };
    const finishing = finishAnalysisRun(run.runId);
    const finishResult = Promise.allSettled([finishing]);
    await bounded(holding.promise, "completion holding only its paper row");
    const { DELETE } = await import("@/app/api/teams/[slug]/members/[memberId]/route");
    const removed = DELETE(new Request("http://localhost/api/teams/la-pg-b/members/la-pg-member", { method: "DELETE" }), { params: Promise.resolve({ slug: "la-pg-b", memberId: member.memberId }) });
    try {
      await bounded(deletion.promise, "removal reaching the membership delete");
      // The old Membership -> Paper order blocks this commit until release.
      await bounded(removed, "member removal committing before completion resumes");
      expect((await removed).status).toBe(200);
    } finally { release.resolve(); }
    const finished = (await finishResult)[0];
    queryHooks.before = undefined; queryHooks.after = undefined;
    expect(finished.status).toBe("rejected");
    if (finished.status === "rejected") expect(finished.reason).toMatchObject({ status: 403 });
    expect(await prisma.analysis.count({ where: { paperId: "la-pg-paper-b" } })).toBe(0);
    expect(await prisma.membership.count({ where: { memberId: member.memberId, teamId: member.teamId } })).toBe(0);
    expect(effects.send).toHaveBeenCalledOnce();
    expect(effects.download).not.toHaveBeenCalled(); expect(effects.render).not.toHaveBeenCalled();
  }, 30_000);
});
