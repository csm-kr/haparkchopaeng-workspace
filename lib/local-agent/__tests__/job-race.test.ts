// @vitest-environment node
// Deterministic PostgreSQL READ COMMITTED model: a stale lookup/count is held
// while the other transaction commits. Actual SQLite races are tested separately.
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const fixture = vi.hoisted(() => {
  function deferred() { let resolve!: () => void; const promise = new Promise<void>((accept) => { resolve = accept; }); return { promise, resolve }; }
  function make(mode: "duplicate" | "capacity" | "cross-device") {
    const paused = deferred(), release = deferred(), contenderWaiting = deferred();
    const now = new Date();
    const rows: Record<string, unknown>[] = Array.from({ length: mode === "capacity" ? 4 : 0 }, (_, i) => ({ id: `existing-${i}`, requestId: `existing-${i}`, status: "queued" }));
    let txCounter = 0, reads = 0;
    const owners = new Map<string, number>(), waiters = new Map<string, (() => void)[]>();
    async function lock(id: number, key: string) {
      if (owners.get(key) === id) return;
      while (owners.has(key)) { contenderWaiting.resolve(); await new Promise<void>((accept) => { const queue = waiters.get(key) ?? []; queue.push(accept); waiters.set(key, queue); }); }
      owners.set(key, id);
    }
    const findExisting = ({ where }: { where: { teamId_memberId_sessionKey_requestId: { requestId: string } } }) => rows.find((row) => row.requestId === where.teamId_memberId_sessionKey_requestId.requestId) ?? null;
    const grant = { id: "grant", deviceId: "device", revokedAt: null, leaseExpiresAt: new Date(now.getTime() + 45_000) };
    const db = { $transaction: async <T>(run: (tx: unknown) => Promise<T>) => {
      const id = ++txCounter;
      const tx = {
        membership: { findUnique: async () => ({ memberId: "member" }) },
        localAgentDevice: { updateMany: async ({ where }: { where: { id: string } }) => { await lock(id, `device:${where.id}`); return { count: 1 }; } },
        localAgentGrant: { findFirst: async ({ where }: { where: { deviceId: string } }) => ({ ...grant, id: `grant:${where.deviceId}`, deviceId: where.deviceId }), updateMany: async ({ where }: { where: { id: string } }) => { await lock(id, where.id); return { count: 1 }; } },
        localAgentSnapshot: { findUnique: async () => ({ observedAt: now, payload: { provider: "codex", status: "ready", models: [{ id: "actual", name: "Actual" }], quota: null, observedAt: now.toISOString() } }) },
        paper: { findFirst: async () => ({ title: "Paper", authors: "Researcher", abstract: "Context", analyses: [], figures: [] }) },
        localAgentJob: {
          findUnique: async (args: Parameters<typeof findExisting>[0]) => { const captured = findExisting(args); if ((mode === "duplicate" || mode === "cross-device") && ++reads === 1) { paused.resolve(); await release.promise; } return captured; },
          count: async () => { const captured = rows.length; if (mode === "capacity" && ++reads === 1) { paused.resolve(); await release.promise; } return captured; },
          create: async ({ data }: { data: Record<string, unknown> }) => { if (rows.some((row) => row.requestId === data.requestId)) throw new Prisma.PrismaClientKnownRequestError("unique request constraint", { code: "P2002", clientVersion: "6.19.3", meta: { target: ["teamId", "memberId", "sessionKey", "requestId"] } }); const row = { ...data, id: `job-${rows.length}`, status: "queued", version: 0, response: "", error: null, createdAt: now, updatedAt: now }; rows.push(row); return row; },
        },
      };
      try { return await run(tx); } finally { for (const [key, owner] of owners) if (owner === id) { owners.delete(key); waiters.get(key)?.shift()?.(); } }
    }, localAgentJob: { findUnique: async (args: Parameters<typeof findExisting>[0]) => findExisting(args) }, membership: { findUnique: async () => ({ memberId: "member" }) } };
    return { db, paused, release, contenderWaiting, rows };
  }
  let current: ReturnType<typeof make>;
  return { set(mode: "duplicate" | "capacity" | "cross-device") { return current = make(mode); }, db: { $transaction: <T>(run: (tx: unknown) => Promise<T>) => current.db.$transaction(run), localAgentJob: { findUnique: (args: Parameters<ReturnType<typeof make>["db"]["localAgentJob"]["findUnique"]>[0]) => current.db.localAgentJob.findUnique(args) }, membership: { findUnique: () => current.db.membership.findUnique() } } };
});
vi.mock("@/lib/prisma", () => ({ prisma: fixture.db }));
import { createJob } from "../service";
const scope = () => ({ teamId: "team", memberId: "member", sessionKey: "session", sessionExpiresAt: new Date(Date.now() + 60_000) });
const input = (requestId: string) => ({ deviceId: "device", paperId: "paper", provider: "codex" as const, model: "actual", prompt: "질문", requestId });

describe("job queue concurrent admission", () => {
  it("returns the same job to two simultaneous identical requests instead of a unique-constraint error", async () => {
    const run = fixture.set("duplicate");
    const first = createJob(scope(), input("same-request"));
    await run.paused.promise;
    const second = createJob(scope(), input("same-request"));
    await Promise.race([second.catch(() => {}), run.contenderWaiting.promise]);
    run.release.resolve();
    const results = await Promise.allSettled([first, second]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(run.rows).toHaveLength(1);
    if (results[0].status === "fulfilled" && results[1].status === "fulfilled") expect(results[0].value.id).toBe(results[1].value.id);
  });

  it("admits only one of two simultaneous requests for the last queue slot", async () => {
    const run = fixture.set("capacity");
    const first = createJob(scope(), input("first-request"));
    await run.paused.promise;
    const second = createJob(scope(), input("second-request"));
    await Promise.race([second.catch(() => {}), run.contenderWaiting.promise]);
    run.release.resolve();
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(run.rows).toHaveLength(5);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ status: 429, code: "QUEUE_FULL" });
  });

  it("returns 409 when the same request ID races across two independently locked devices", async () => {
    const run = fixture.set("cross-device");
    const first = createJob(scope(), { ...input("same-request"), deviceId: "first-device" });
    await run.paused.promise;
    const second = await createJob(scope(), { ...input("same-request"), deviceId: "second-device" });
    run.release.resolve();
    await expect(first).rejects.toMatchObject({ status: 409, code: "REQUEST_ID_REUSED" });
    expect(second.id).toBe("job-0");
    expect(run.rows).toHaveLength(1);
  });
});
