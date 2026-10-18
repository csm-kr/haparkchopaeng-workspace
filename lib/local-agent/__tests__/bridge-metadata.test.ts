// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  type Snapshot = { deviceId: string; provider: string; payload: Record<string, unknown>; observedAt: Date };
  const snapshots = new Map<string, Snapshot>();
  const device = { id: "device", memberId: "member", teamId: "team", secretHash: "", revokedAt: null as Date | null, name: "Research PC", platform: "macos", lastSeenAt: null as Date | null };
  const grant = { deviceId: "device", memberId: "member", teamId: "team", sessionKey: "web-session", revokedAt: null as Date | null, leaseExpiresAt: new Date() };
  const db = {
    membership: { findUnique: vi.fn(async () => ({ memberId: "member" })) },
    localAgentDevice: {
      findUnique: vi.fn(async () => device),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; secretHash: string }; data: { lastSeenAt: Date } }) => {
        if (where.id !== device.id || where.secretHash !== device.secretHash || device.revokedAt) return { count: 0 };
        device.lastSeenAt = data.lastSeenAt;
        return { count: 1 };
      }),
    },
    localAgentGrant: {
      findFirst: vi.fn(async () => !grant.revokedAt && grant.leaseExpiresAt > new Date() ? grant : null),
      findMany: vi.fn(async ({ where }: { where: { sessionKey: string; teamId: string; memberId: string } }) => !grant.revokedAt && where.sessionKey === grant.sessionKey && where.teamId === grant.teamId && where.memberId === grant.memberId ? [{ ...grant, device }] : []),
    },
    localAgentSnapshot: {
      findUnique: vi.fn(async ({ where }: { where: { deviceId_provider: { provider: string } } }) => snapshots.get(where.deviceId_provider.provider) ?? null),
      findMany: vi.fn(async ({ where }: { where: { deviceId: string } }) => [...snapshots.values()].filter((row) => row.deviceId === where.deviceId)),
      upsert: vi.fn(async ({ where, create, update }: { where: { deviceId_provider: { provider: string } }; create: Snapshot; update: Pick<Snapshot, "payload" | "observedAt"> }) => {
        const key = where.deviceId_provider.provider;
        const previous = snapshots.get(key);
        snapshots.set(key, structuredClone(previous ? { ...previous, ...update } : create));
        return snapshots.get(key);
      }),
      deleteMany: vi.fn(async ({ where }: { where: { deviceId: string; provider?: { notIn: string[] } } }) => {
        let count = 0;
        for (const [key, row] of snapshots) if (row.deviceId === where.deviceId && (!where.provider?.notIn || !where.provider.notIn.includes(row.provider))) { snapshots.delete(key); count++; }
        return { count };
      }),
    },
    localAgentJob: { updateMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn(async () => []) },
  };
  return { snapshots, device, grant, db, prisma: { ...db, $transaction: vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db)) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: fixture.prisma }));
import { desktopHeartbeat, getStatus } from "../service";
import { hashCredential } from "../security";

const deviceToken = Buffer.alloc(32, 26).toString("base64url");
const identity = { deviceId: "device", deviceToken };
const scope = { memberId: "member", teamId: "team", sessionKey: "web-session", sessionExpiresAt: new Date("2026-10-18T12:10:00.000Z") };
const metadata = { bridgeVersion: "0.1.5", bridgeArchitecture: "arm64" as const };
const snapshot = () => ({ provider: "codex" as const, status: "ready" as const, models: [{ id: "actual-model", name: "Actual model", reasoningEfforts: ["low" as const, "high" as const] }], quota: { short: { label: "5h", remainingPercent: 62, resetsAt: null }, weekly: null }, observedAt: new Date().toISOString() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-10-18T12:00:00.000Z");
  fixture.snapshots.clear();
  Object.assign(fixture.device, { secretHash: hashCredential(deviceToken), revokedAt: null, lastSeenAt: new Date() });
  Object.assign(fixture.grant, { revokedAt: null, leaseExpiresAt: new Date(Date.now() + 45_000) });
});
afterEach(() => { vi.useRealTimers(); });

describe("the running bridge app metadata", () => {
  it("reports the authenticated app version and architecture even when no CLI providers are installed", async () => {
    const heartbeat = await desktopHeartbeat(identity, [], metadata);
    expect(heartbeat.leaseExpiresAt).toBe("2026-10-18T12:00:45.000Z");
    expect((await getStatus(scope, identity.deviceId)).device).toMatchObject({ online: true, bridgeVersion: "0.1.5", bridgeArchitecture: "arm64", providers: [] });
  });
  it("returns unknown for old apps and clears a prior self-report without changing actual model or quota metadata", async () => {
    await desktopHeartbeat(identity, [snapshot()], metadata);
    expect((await getStatus(scope, identity.deviceId)).device?.providers).toEqual([snapshot()]);
    await desktopHeartbeat(identity, [snapshot()]);
    expect((await getStatus(scope, identity.deviceId)).device).toMatchObject({ bridgeVersion: null, bridgeArchitecture: null, providers: [snapshot()] });
    await desktopHeartbeat(identity, [], { bridgeArchitecture: "x64" });
    expect((await getStatus(scope, identity.deviceId)).device).toMatchObject({ bridgeVersion: null, bridgeArchitecture: "x64", providers: [] });
  });
  it("hides metadata at the exact offline boundary and when only its stored observation is stale or in the future", async () => {
    await desktopHeartbeat(identity, [], metadata);
    vi.setSystemTime(Date.now() + 20_000);
    expect((await getStatus(scope, identity.deviceId)).device).toMatchObject({ online: false, bridgeVersion: null, bridgeArchitecture: null });
    fixture.device.lastSeenAt = new Date();
    expect((await getStatus(scope, identity.deviceId)).device).toMatchObject({ online: true, bridgeVersion: null, bridgeArchitecture: null });
    const stored = fixture.snapshots.get("_bridge");
    if (!stored) throw new Error("missing stored app report");
    stored.observedAt = new Date(Date.now() + 1);
    expect((await getStatus(scope, identity.deviceId)).device).toMatchObject({ bridgeVersion: null, bridgeArchitecture: null });
  });
  it("does not expose or overwrite the report after lease expiry, revocation or an invalid device credential", async () => {
    await desktopHeartbeat(identity, [], metadata);
    const writes = fixture.db.localAgentSnapshot.upsert.mock.calls.length;
    fixture.grant.leaseExpiresAt = new Date();
    expect((await getStatus(scope, identity.deviceId)).device).toMatchObject({ online: false, bridgeVersion: null, bridgeArchitecture: null });
    await expect(desktopHeartbeat(identity, [], { bridgeVersion: "9.9.9" })).rejects.toMatchObject({ status: 403 });
    fixture.grant.revokedAt = new Date();
    expect((await getStatus(scope, identity.deviceId)).device).toBeNull();
    await expect(desktopHeartbeat({ ...identity, deviceToken: Buffer.alloc(32, 27).toString("base64url") }, [], metadata)).rejects.toMatchObject({ status: 401 });
    expect(fixture.db.localAgentSnapshot.upsert.mock.calls.length).toBe(writes);
  });
  it("keeps a newer provider logout while accepting the app's current independent self-report", async () => {
    const loggedOut = { ...snapshot(), status: "login_required" as const };
    await desktopHeartbeat(identity, [loggedOut], metadata);
    await desktopHeartbeat(identity, [{ ...snapshot(), observedAt: "2026-10-18T11:59:59.000Z" }], metadata);
    expect((await getStatus(scope, identity.deviceId)).device).toMatchObject({ ...metadata, providers: [{ provider: "codex", status: "login_required", models: [], quota: null }] });
  });
  it("never turns a malformed reserved app row into a provider catalogue or version claim", async () => {
    await desktopHeartbeat(identity, [], metadata);
    const stored = fixture.snapshots.get("_bridge");
    if (!stored) throw new Error("missing stored app report");
    stored.payload = snapshot();
    expect((await getStatus(scope, identity.deviceId)).device).toMatchObject({ bridgeVersion: null, bridgeArchitecture: null, providers: [] });
    stored.payload = { version: 1, bridgeVersion: "latest", bridgeArchitecture: "arm64" };
    expect((await getStatus(scope, identity.deviceId)).device).toMatchObject({ bridgeVersion: null, bridgeArchitecture: null, providers: [] });
  });
});
