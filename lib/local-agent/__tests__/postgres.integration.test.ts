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
  await prisma.paper.deleteMany({ where: { id: { startsWith: "la-pg-" } } });
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
    await cleanFixtures();
    for (const id of ["la-pg-owner", "la-pg-member"]) await prisma.member.create({ data: { id, name: id, email: `${id}@test.invalid`, handle: `@${id}`, role: "멤버", color: "var(--m-ha)", initial: "하" } });
    for (const id of ["la-pg-a", "la-pg-b"]) await prisma.team.create({ data: { id, slug: id, name: id, createdBy: "la-pg-owner", memberships: { create: { memberId: "la-pg-owner", role: "owner" } } } });
    await prisma.membership.create({ data: { teamId: "la-pg-b", memberId: "la-pg-member", role: "member" } });
    for (const suffix of ["a", "b"]) await prisma.paper.create({ data: { id: `la-pg-paper-${suffix}`, teamId: `la-pg-${suffix}`, title: "Disposable concurrency fixture", authors: "CI", abstract: "No external paper data", pdfUrl: "fixture.pdf", uploadedBy: "la-pg-owner", tags: [], analysisStatus: "ready" } });
  });
  afterAll(async () => { queryHooks.before = undefined; queryHooks.after = undefined; await cleanFixtures(); await prisma.$disconnect(); });

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
});
