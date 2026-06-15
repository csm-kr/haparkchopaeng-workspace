import { beforeEach, describe, expect, it, vi } from "vitest";

// listTeamMembers — 멤버십 ⨝ Member 매핑(ADR-018). prisma 모킹.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    membership: { findMany: vi.fn() },
    member: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { listTeamMembers } = await import("@/lib/teams");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listTeamMembers()", () => {
  it("멤버십 합류 순으로 Member 정보를 합쳐 역할(영어)과 함께 돌려준다", async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      { teamId: "t1", memberId: "ha", role: "owner", joinedAt: new Date(1) },
      { teamId: "t1", memberId: "bak", role: "admin", joinedAt: new Date(2) },
    ]);
    prismaMock.member.findMany.mockResolvedValue([
      { id: "ha", name: "하수현", handle: "@ha", email: "ha@x.team", color: "var(--m-ha)", initial: "하" },
      { id: "bak", name: "박진희", handle: "@bak", email: "bak@x.team", color: "var(--m-bak)", initial: "박" },
    ]);

    const rows = await listTeamMembers("t1");
    expect(rows).toEqual([
      { id: "ha", name: "하수현", handle: "@ha", email: "ha@x.team", color: "var(--m-ha)", initial: "하", role: "owner" },
      { id: "bak", name: "박진희", handle: "@bak", email: "bak@x.team", color: "var(--m-bak)", initial: "박", role: "admin" },
    ]);
    // teamId로 조회한다(memberId 아님).
    expect(prismaMock.membership.findMany.mock.calls[0][0].where).toEqual({ teamId: "t1" });
  });

  it("알 수 없는 역할 문자열은 member로 좁힌다", async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      { teamId: "t1", memberId: "x", role: "weird", joinedAt: new Date(1) },
    ]);
    prismaMock.member.findMany.mockResolvedValue([
      { id: "x", name: "X", handle: "@x", email: "x@x.team", color: "var(--m-jo)", initial: "X" },
    ]);
    const rows = await listTeamMembers("t1");
    expect(rows[0].role).toBe("member");
  });
});
