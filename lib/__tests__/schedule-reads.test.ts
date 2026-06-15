import { beforeEach, describe, expect, it, vi } from "vitest";

// 스케줄·벌금 읽기 팀 스코핑(ADR-020/R37) — getMonth·getFines가 활성 팀 데이터만 본다.
// CRITICAL: 활성 팀이 A면 B의 달/벌금이 절대 조회에 섞이지 않는다(R37). 빈 팀은 null(빈 달/설정 없음).
// 순수 로직(saturdaysOf·draftMonth 등)은 schedule.test.ts가 담당 — 여긴 prisma 백킹 읽기만.

interface MonthRow {
  id: string;
  teamId: string;
  year: number;
  month: number;
  day: string;
  rotationPointerAfter: number;
  version: number;
  weeks: unknown[];
}
interface FineRow {
  teamId: string;
  year: number;
  finePresenter: number;
  fineAbsent: number;
  ledgers: unknown[];
}

const { db } = vi.hoisted(() => ({
  db: {
    months: [] as MonthRow[],
    fines: [] as FineRow[],
    members: [] as Array<{ id: string; name: string; initial: string; color: string }>,
  },
}));

function matchTeam(rowTeam: string, whereTeam: unknown): boolean {
  return whereTeam === undefined || rowTeam === whereTeam;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    scheduleMonth: {
      findFirst: vi.fn(
        async ({ where }: { where: { teamId?: string; year: number; month: number } }) =>
          db.months.find(
            (m) =>
              m.year === where.year &&
              m.month === where.month &&
              matchTeam(m.teamId, where.teamId),
          ) ?? null,
      ),
    },
    fineConfig: {
      findFirst: vi.fn(
        async ({ where }: { where: { teamId?: string; year: number } }) =>
          db.fines.find(
            (f) => f.year === where.year && matchTeam(f.teamId, where.teamId),
          ) ?? null,
      ),
    },
    member: {
      findMany: vi.fn(async () => db.members),
    },
  },
}));

import { getFines, getMonth } from "@/lib/schedule";

beforeEach(() => {
  // 같은 연/월·연도가 두 팀에 각각 존재 — 격리가 없으면 서로 샌다.
  db.months = [
    { id: "mA", teamId: "tA", year: 2026, month: 7, day: "토요일", rotationPointerAfter: 1, version: 2, weeks: [] },
    { id: "mB", teamId: "tB", year: 2026, month: 7, day: "토요일", rotationPointerAfter: 3, version: 5, weeks: [] },
  ];
  db.fines = [
    { teamId: "tA", year: 2026, finePresenter: 30000, fineAbsent: 10000, ledgers: [] },
    { teamId: "tB", year: 2026, finePresenter: 50000, fineAbsent: 20000, ledgers: [] },
  ];
  db.members = [{ id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)" }];
});

describe("getMonth(year, month, teamId) — 교차 팀 격리", () => {
  it("활성 팀 A의 달을 돌려준다(B의 값이 섞이지 않음)", async () => {
    const m = await getMonth(2026, 7, "tA");
    expect(m?.rotationPointerAfter).toBe(1);
    expect(m?.version).toBe(2);
  });

  it("빈 팀이면 null(빈 달) — row를 만들지 않는다", async () => {
    expect(await getMonth(2026, 7, "tEmpty")).toBeNull();
  });
});

describe("getFines(year, teamId) — 교차 팀 격리", () => {
  it("활성 팀 A의 벌금 설정을 돌려준다(B의 금액이 섞이지 않음)", async () => {
    const f = await getFines(2026, "tA");
    expect(f?.finePresenter).toBe(30000);
    expect(f?.fineAbsent).toBe(10000);
  });

  it("빈 팀이면 null(설정 없음)", async () => {
    expect(await getFines(2026, "tEmpty")).toBeNull();
  });
});
