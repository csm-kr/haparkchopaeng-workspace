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
      // callback 형(저장)과 배열 형(reorderRotation) 둘 다 지원.
      $transaction: vi.fn(async (arg: unknown) =>
        typeof arg === "function"
          ? (arg as (tx: typeof txMock) => unknown)(txMock)
          : Promise.all(arg as unknown[]),
      ),
      fineConfig: { updateMany: vi.fn(), upsert: vi.fn() },
      memberLedger: { upsert: vi.fn() },
      membership: { findMany: vi.fn() },
      member: { update: vi.fn() },
    },
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { createFineConfig, reorderRotation, saveMonth, updateFines, updateLedger } =
  await import("@/app/(app)/schedule/actions");

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

describe("reorderRotation — 활성 팀 멤버만 재정렬", () => {
  it("팀 소속 아닌 id는 거르고 보낸 순서대로 rotationOrder 1..N을 쓴다", async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      { memberId: "ha" },
      { memberId: "bak" },
    ]);
    getScheduleMembersMock.mockResolvedValue([{ id: "bak" }, { id: "ha" }]);

    // "jo"(다른 팀)는 무시되고, ha·bak만 보낸 순서대로 굳는다.
    await reorderRotation(["bak", "jo", "ha"]);

    // 멤버십 조회는 활성 팀(tA)으로 스코핑된다.
    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: "tA" }) }),
    );
    // jo는 제외 → bak=1, ha=2 (두 번만 update).
    expect(prismaMock.member.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.member.update).toHaveBeenNthCalledWith(1, {
      where: { id: "bak" },
      data: { rotationOrder: 1 },
    });
    expect(prismaMock.member.update).toHaveBeenNthCalledWith(2, {
      where: { id: "ha" },
      data: { rotationOrder: 2 },
    });
  });

  it("활성 팀이 없으면 throw하고 아무것도 쓰지 않는다", async () => {
    getActiveTeamMock.mockResolvedValue(null);
    await expect(reorderRotation(["ha"])).rejects.toThrow();
    expect(prismaMock.member.update).not.toHaveBeenCalled();
  });
});

describe("createFineConfig — 명시 생성(멱등)", () => {
  it("관리자일 때 (teamId, year)로 upsert하고 getFines를 반환한다", async () => {
    prismaMock.fineConfig.upsert.mockResolvedValue({});
    getFinesMock.mockResolvedValue({
      year: 2026,
      finePresenter: 30000,
      fineAbsent: 10000,
      members: [],
    });

    const out = await createFineConfig(2026);

    // 멱등 upsert — where는 복합키 (teamId, year), 활성 팀에서 주입(R3).
    expect(prismaMock.fineConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId_year: { teamId: "tA", year: 2026 } },
      }),
    );
    expect(out).toMatchObject({ year: 2026 });
  });

  it("활성 팀이 없으면 throw하고 upsert 미호출", async () => {
    getActiveTeamMock.mockResolvedValue(null);
    await expect(createFineConfig(2026)).rejects.toThrow();
    expect(prismaMock.fineConfig.upsert).not.toHaveBeenCalled();
  });

  it("비관리자(requireRole throw)면 reject하고 아무것도 쓰지 않는다", async () => {
    requireRoleMock.mockRejectedValue(new Error("forbidden"));
    await expect(createFineConfig(2026)).rejects.toThrow();
    expect(prismaMock.fineConfig.upsert).not.toHaveBeenCalled();
  });
});

describe("updateLedger — 팀 멤버만 수동 편집", () => {
  it("팀 소속 아닌 memberId는 거르고 팀 멤버만 teamId 주입해 upsert한다", async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      { memberId: "ha" },
      { memberId: "bak" },
    ]);
    getFinesMock.mockResolvedValue({
      year: 2026,
      finePresenter: 30000,
      fineAbsent: 10000,
      members: [],
    });

    await updateLedger({
      year: 2026,
      rows: [
        { memberId: "ha", count: 3, missedPresenter: 1, missedAbsent: 0, paid: 0 },
        // jo는 다른 팀 — membership에 없으므로 무시되어야 한다(R3/R37).
        { memberId: "jo", count: 9, missedPresenter: 9, missedAbsent: 9, paid: 9 },
        { memberId: "bak", count: 2, missedPresenter: 0, missedAbsent: 1, paid: 5000 },
      ],
    });

    // 멤버십 조회는 활성 팀(tA)으로 스코핑된다.
    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: "tA" }) }),
    );
    // jo는 제외 — ha, bak 두 번만 upsert.
    expect(prismaMock.memberLedger.upsert).toHaveBeenCalledTimes(2);
    const calls = prismaMock.memberLedger.upsert.mock.calls.map((c) => c[0]);
    // teamId·memberId는 서버가 결정한 복합키, create.teamId는 활성 팀 주입.
    expect(calls[0].where).toEqual({
      teamId_year_memberId: { teamId: "tA", year: 2026, memberId: "ha" },
    });
    expect(calls[0].create.teamId).toBe("tA");
    expect(
      calls.some((c) => c.where.teamId_year_memberId.memberId === "jo"),
    ).toBe(false);
  });

  it("음수 값이면 reject하고 아무것도 쓰지 않는다", async () => {
    prismaMock.membership.findMany.mockResolvedValue([{ memberId: "ha" }]);
    await expect(
      updateLedger({
        year: 2026,
        rows: [
          { memberId: "ha", count: 1, missedPresenter: 0, missedAbsent: 0, paid: -1 },
        ],
      }),
    ).rejects.toThrow();
    expect(prismaMock.memberLedger.upsert).not.toHaveBeenCalled();
  });

  it("활성 팀이 없으면 throw하고 upsert 미호출", async () => {
    getActiveTeamMock.mockResolvedValue(null);
    await expect(
      updateLedger({
        year: 2026,
        rows: [
          { memberId: "ha", count: 1, missedPresenter: 0, missedAbsent: 0, paid: 0 },
        ],
      }),
    ).rejects.toThrow();
    expect(prismaMock.memberLedger.upsert).not.toHaveBeenCalled();
  });
});
