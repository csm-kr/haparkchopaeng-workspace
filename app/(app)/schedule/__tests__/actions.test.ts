import { beforeEach, describe, expect, it, vi } from "vitest";

// 스케줄/벌금 쓰기 Server Action 팀 스코핑(ADR-020/R37) — 활성 팀 안에서만 저장·수정.
// CRITICAL: 저장은 (teamId, year, month) 키로(낙관적 락은 팀 스코프 안에서, R35). teamId는
//   활성 팀에서 주입한다(R3). 활성 팀 없으면 거부.

const { requireRoleMock } = vi.hoisted(() => ({ requireRoleMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(), requireRole: requireRoleMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { resolveStartIdxMock, getScheduleMembersMock, getFinesMock } = vi.hoisted(
  () => ({
    resolveStartIdxMock: vi.fn(),
    getScheduleMembersMock: vi.fn(),
    getFinesMock: vi.fn(),
  }),
);
vi.mock("@/lib/schedule", () => ({
  resolveStartIdx: resolveStartIdxMock,
  getScheduleMembers: getScheduleMembersMock,
  getFines: getFinesMock,
}));

const { txMock, prismaMock } = vi.hoisted(() => {
  const txMock = {
    scheduleMonth: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
      fineConfig: { updateMany: vi.fn() },
    },
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { saveMonth, updateFines } = await import("@/app/(app)/schedule/actions");

const validWeeks = [
  {
    week: 1,
    date: "8월 1일",
    time: "10:00",
    presenterId: "ha",
    topic: "주제",
    confirmed: true,
    status: "upcoming" as const,
    presentationId: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "owner" });
  resolveStartIdxMock.mockResolvedValue(0);
  getScheduleMembersMock.mockResolvedValue([{ id: "ha" }, { id: "bak" }]);
});

describe("saveMonth — 팀 스코핑 저장", () => {
  it("활성 팀이 없으면 FORBIDDEN", async () => {
    getActiveTeamMock.mockResolvedValue(null);
    const out = await saveMonth({ year: 2026, month: 8, version: 0, weeks: validWeeks });
    expect(out).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("새 달이면 teamId=활성 팀로 create하고 findFirst를 teamId로 스코핑", async () => {
    txMock.scheduleMonth.findFirst.mockResolvedValue(null); // 빈 달
    txMock.scheduleMonth.create.mockResolvedValue({
      year: 2026,
      month: 8,
      day: "토요일",
      rotationPointerAfter: 1,
      version: 1,
      weeks: validWeeks.map((w) => ({ ...w, topic: w.topic })),
    });

    const out = await saveMonth({ year: 2026, month: 8, version: 0, weeks: validWeeks });
    expect(out.ok).toBe(true);

    // findFirst는 (teamId, year, month)로 — 다른 팀의 같은 달과 섞이지 않는다.
    expect(txMock.scheduleMonth.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ teamId: "tA", year: 2026, month: 8 }),
      }),
    );
    // create teamId는 활성 팀에서 주입(R3).
    expect(txMock.scheduleMonth.create.mock.calls[0][0].data.teamId).toBe("tA");
    // 순번도 같은 팀에서 이어받는다.
    expect(resolveStartIdxMock).toHaveBeenCalledWith(2026, 8, "tA");
  });
});

describe("updateFines — 팀 스코핑 수정", () => {
  it("updateMany를 (teamId, year)로 스코핑한다", async () => {
    prismaMock.fineConfig.updateMany.mockResolvedValue({ count: 1 });
    getFinesMock.mockResolvedValue({
      year: 2026,
      finePresenter: 30000,
      fineAbsent: 10000,
      members: [],
    });

    await updateFines({ year: 2026, finePresenter: 30000, fineAbsent: 10000 });

    expect(prismaMock.fineConfig.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ teamId: "tA", year: 2026 }),
      }),
    );
  });
});
