// @vitest-environment node
// Force a PostgreSQL READ COMMITTED interleaving. SQLite serializes writers itself,
// so its integration tests alone cannot expose a stale read/upsert reversal.
import { describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  function deferred() { let resolve!: () => void; const promise = new Promise<void>((accept) => { resolve = accept; }); return { promise, resolve }; }
  const oldRead = deferred(), releaseOld = deferred(), secondLockWait = deferred();
  const now = Date.now();
  let payload: Record<string, unknown> = { provider: "codex", status: "ready", models: [{ id: "model", name: "Model" }], quota: null, observedAt: new Date(now - 2000).toISOString() };
  let observedAt = new Date(now - 2000), reads = 0, txId = 0, owner: number | null = null;
  const waiters: (() => void)[] = [];
  async function lock(id: number) {
    if (owner === id) return;
    while (owner !== null) { secondLockWait.resolve(); await new Promise<void>((accept) => waiters.push(accept)); }
    owner = id;
  }
  const device = { id: "device", memberId: "member", teamId: "team", revokedAt: null, secretHash: "", name: "PC", platform: "windows", lastSeenAt: new Date(now), createdAt: new Date(now) };
  const db = { $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
    const id = ++txId;
    const tx = {
      membership: { findUnique: async () => ({ memberId: "member" }) },
      localAgentDevice: { findUnique: async () => device, update: async () => { await lock(id); return device; }, updateMany: async () => { await lock(id); return { count: 1 }; } },
      localAgentGrant: { findFirst: async () => ({ leaseExpiresAt: new Date(now + 45_000) }) },
      localAgentSnapshot: {
        findUnique: async () => { const captured = { payload: structuredClone(payload), observedAt: new Date(observedAt) }; if (++reads === 1) { oldRead.resolve(); await releaseOld.promise; } return captured; },
        findMany: async () => [{ payload: structuredClone(payload), observedAt: new Date(observedAt), provider: "codex" }],
        upsert: async ({ update }: { update: { payload: Record<string, unknown>; observedAt: Date } }) => { payload = structuredClone(update.payload); observedAt = update.observedAt; return {}; },
        updateMany: async ({ data }: { data: { payload: Record<string, unknown>; observedAt: Date } }) => { payload = structuredClone(data.payload); observedAt = data.observedAt; return { count: 1 }; },
        deleteMany: async () => ({ count: 0 }),
      },
      localAgentJob: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
    };
    try { return await run(tx); } finally { if (owner === id) { owner = null; waiters.shift()?.(); } }
  } };
  return { db, device, oldRead, releaseOld, secondLockWait, now, getPayload: () => payload };
});
vi.mock("@/lib/prisma", () => ({ prisma: fixture.db }));
import { desktopHeartbeat } from "../service";
import { hashCredential } from "../security";

describe("heartbeat snapshot ordering", () => {
  it("does not overwrite a newer provider logout with an earlier ready snapshot under forced contention", async () => {
    const deviceToken = Buffer.alloc(32, 7).toString("base64url");
    fixture.device.secretHash = hashCredential(deviceToken);
    const identity = { deviceId: fixture.device.id, deviceToken };
    const old = desktopHeartbeat(identity, [{ provider: "codex", status: "ready", models: [{ id: "model", name: "Model" }], quota: null, observedAt: new Date(fixture.now - 1000).toISOString() }]);
    await fixture.oldRead.promise;
    const newer = desktopHeartbeat(identity, [{ provider: "codex", status: "login_required", models: [], quota: null, observedAt: new Date(fixture.now).toISOString() }]);
    await Promise.race([newer, fixture.secondLockWait.promise]);
    fixture.releaseOld.resolve();
    await Promise.all([old, newer]);
    expect(fixture.getPayload().status).toBe("login_required");
    expect(fixture.getPayload().models).toEqual([]);
  });
});
