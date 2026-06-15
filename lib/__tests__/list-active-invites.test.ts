import { beforeEach, describe, expect, it, vi } from "vitest";

// listActiveInvites — 활성 초대(회수×·미만료·여력) 매핑(ADR-018). prisma 모킹.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { invite: { findMany: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { listActiveInvites } = await import("@/lib/invite");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listActiveInvites()", () => {
  it("소진된 초대는 빼고, 역할(영어)·사용 횟수·ISO 시각으로 매핑한다", async () => {
    const created = new Date("2026-06-15T00:00:00.000Z");
    const exp = new Date("2026-06-22T00:00:00.000Z");
    prismaMock.invite.findMany.mockResolvedValue([
      { id: "i1", role: "member", maxUses: 3, usedCount: 1, expiresAt: exp, createdAt: created },
      { id: "i2", role: "admin", maxUses: 2, usedCount: 2, expiresAt: exp, createdAt: created }, // 소진 → 제외
    ]);

    const rows = await listActiveInvites("t1");
    expect(rows).toEqual([
      {
        id: "i1",
        role: "member",
        maxUses: 3,
        usedCount: 1,
        expiresAt: "2026-06-22T00:00:00.000Z",
        createdAt: "2026-06-15T00:00:00.000Z",
      },
    ]);
    // teamId·미회수·미만료 조건으로 조회한다.
    const where = prismaMock.invite.findMany.mock.calls[0][0].where;
    expect(where.teamId).toBe("t1");
    expect(where.revokedAt).toBeNull();
  });
});
