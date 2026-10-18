// @vitest-environment node
// Force two READ COMMITTED stale reads before either first-ACK CAS. This model
// supplements the real isolated SQLite lifecycle tests; it is not a live PG run.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalAgentAttempt } from "@prisma/client";
const fixture = vi.hoisted(() => {
  function make(seed: LocalAgentAttempt) {
    let row = structuredClone(seed), reads = 0;
    let release!: () => void;
    const bothLoaded = new Promise<void>((accept) => { release = accept; });
    const updateMany = vi.fn(async ({ where, data }: {
      where: { id: string; version: number; status?: string; cancelledAt?: null; consumedAt?: null; expiresAt?: { gt: Date }; sessionExpiresAt?: { gt: Date }; failedAttempts?: { lt: number } };
      data: { pendingSecretHash: string; pendingName: string; pendingPlatform: string; status: string; expiresAt?: Date; version: { increment: number } };
    }) => {
      if (row.id !== where.id || row.version !== where.version || (where.status && row.status !== where.status) || row.cancelledAt || row.consumedAt ||
          (where.expiresAt && row.expiresAt <= where.expiresAt.gt) || (where.sessionExpiresAt && row.sessionExpiresAt <= where.sessionExpiresAt.gt) ||
          (where.failedAttempts && row.failedAttempts >= where.failedAttempts.lt)) return { count: 0 };
      row = { ...row, ...data, version: row.version + data.version.increment };
      return { count: 1 };
    });
    const tx = {
      localAgentAttempt: {
        findUnique: async () => {
          const captured = structuredClone(row);
          if (++reads <= 2) { if (reads === 2) release(); await bothLoaded; }
          return captured;
        },
        updateMany,
      },
      membership: { findUnique: async () => ({ memberId: row.memberId }) },
      localAgentDevice: { findFirst: async () => null },
      team: { findUnique: async () => ({ name: "Team" }) },
      member: { findUnique: async () => ({ name: "Member" }) },
    };
    return { db: { $transaction: <T>(run: (db: typeof tx) => Promise<T>) => run(tx) }, updateMany, row: () => row };
  }
  let current: ReturnType<typeof make>;
  return { set(seed: LocalAgentAttempt) { return current = make(seed); }, db: { $transaction: <T>(run: (tx: unknown) => Promise<T>) => current.db.$transaction(run) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: fixture.db }));
import { acknowledgeDesktop } from "../service";
import { hashCredential } from "../security";

const launchToken = Buffer.alloc(32, 8).toString("base64url");
const key = Buffer.alloc(32, 1).toString("base64url");
const otherKey = Buffer.alloc(32, 2).toString("base64url");
const started = new Date("2026-10-18T02:00:00.000Z");
function seed(): LocalAgentAttempt {
  return { id: "attempt", teamId: "team", memberId: "member", sessionKey: "session", sessionExpiresAt: new Date(started.getTime() + 3_600_000),
    launchTokenHash: hashCredential(launchToken), codeHash: hashCredential("attempt:123456"), status: "awaiting_app", failedAttempts: 0,
    pendingSecretHash: null, pendingName: null, pendingPlatform: null, deviceId: null, expiresAt: new Date(started.getTime() + 5 * 60_000),
    consumedAt: null, cancelledAt: null, version: 0, createdAt: started };
}
const input = (deviceToken: string) => ({ attemptId: "attempt", launchToken, deviceToken, deviceName: "PC", platform: "windows" as const });
afterEach(() => { vi.useRealTimers(); });

describe("first ACK atomic retry ordering", () => {
  it("returns one fixed deadline to both same-key callers after the losing CAS rereads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(started.getTime() + 4 * 60_000);
    const run = fixture.set(seed());
    const results = await Promise.all([acknowledgeDesktop(input(key)), acknowledgeDesktop(input(key))]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ status: "awaiting_code", version: 1, expiresAt: new Date(started.getTime() + 9 * 60_000).toISOString() });
    expect(run.row().version).toBe(1);
    expect(run.updateMany.mock.calls).toHaveLength(2);
    expect(run.updateMany.mock.calls.every(([args]) => args.where.status === "awaiting_app")).toBe(true);
  });

  it("identifies a different-key CAS loser without exposing or replacing the winner", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(started.getTime() + 4 * 60_000);
    const run = fixture.set(seed());
    const results = await Promise.allSettled([acknowledgeDesktop(input(key)), acknowledgeDesktop(input(otherKey))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ status: 409, code: "ANOTHER_CONNECTOR" });
    expect(run.row()).toMatchObject({ version: 1, failedAttempts: 0, status: "awaiting_code", expiresAt: new Date(started.getTime() + 9 * 60_000) });
  });
});
