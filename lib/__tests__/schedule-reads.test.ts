import { beforeEach, describe, expect, it, vi } from "vitest";

// 스케줄·벌금 읽기 팀 스코핑(ADR-020/R37) — getMonth·getFines·getScheduleMembers가 활성 팀 데이터만 본다.
// CRITICAL: 활성 팀이 A면 B의 달/벌금/멤버가 절대 조회에 섞이지 않는다(R37). 빈 팀은 null(빈 달/설정 없음).
// 멤버는 전역 Member이지만 소속은 Membership으로 결정 — 활성 팀의 멤버만 로테이션/장부에 나온다.
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
interface MemberRow {
  id: string;
  name: string;
  initial: string;
  color: string;
  availability: string;
  rotationOrder: number | null;
  createdAt: Date;
}

const { db } = vi.hoisted(() => ({
  db: {
    months: [] as MonthRow[],
    fines: [] as FineRow[],
    members: [] as MemberRow[],
    memberships: [] as Array<{ teamId: string; memberId: string }>,
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
    membership: {
      findMany: vi.fn(async ({ where }: { where: { teamId: string } }) =>
        db.memberships.filter((ms) => ms.teamId === where.teamId),
      ),
    },
    member: {
      // id.in 필터를 흉내낸다(활성 팀 멤버만). 필터가 없으면 전부(레거시 호출 방어용).
      findMany: vi.fn(
        async ({ where }: { where?: { id?: { in: string[] } } } = {}) => {
          if (where?.id?.in) {
            const set = new Set(where.id.in);
            return db.members.filter((m) => set.has(m.id));
          }
          return db.members;
        },
      ),
    },
  },
}));

import { getFines, getMonth, getScheduleMembers } from "@/lib/schedule";

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
  // ha·bak은 팀 A, jo는 팀 B — 활성 팀이 A면 jo는 절대 나오면 안 된다.
  db.members = [
    { id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)", availability: "active", rotationOrder: null, createdAt: new Date(1) },
    { id: "bak", name: "박지은", initial: "박", color: "var(--m-bak)", availability: "active", rotationOrder: null, createdAt: new Date(2) },
    { id: "jo", name: "조성민", initial: "조", color: "var(--m-jo)", availability: "active", rotationOrder: null, createdAt: new Date(3) },
  ];
  db.memberships = [
    { teamId: "tA", memberId: "ha" },
    { teamId: "tA", memberId: "bak" },
    { teamId: "tB", memberId: "jo" },
  ];
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

describe("getScheduleMembers(teamId) — 활성 팀 멤버만", () => {
  it("팀 A의 멤버만 돌려준다(다른 팀 jo가 섞이지 않음)", async () => {
    const members = await getScheduleMembers("tA");
    expect(members.map((m) => m.id)).toEqual(["ha", "bak"]);
  });

  it("팀 B의 멤버만 돌려준다(jo만)", async () => {
    const members = await getScheduleMembers("tB");
    expect(members.map((m) => m.id)).toEqual(["jo"]);
  });

  it("멤버 없는 팀이면 빈 배열", async () => {
    expect(await getScheduleMembers("tEmpty")).toEqual([]);
  });
});

describe("getFines(year, teamId) — 교차 팀 격리", () => {
  it("활성 팀 A의 벌금 설정을 돌려준다(B의 금액이 섞이지 않음)", async () => {
    const f = await getFines(2026, "tA");
    expect(f?.finePresenter).toBe(30000);
    expect(f?.fineAbsent).toBe(10000);
  });

  it("장부 표에 활성 팀 멤버만 나온다(다른 팀 jo 제외)", async () => {
    const f = await getFines(2026, "tA");
    expect(f?.members.map((r) => r.memberId)).toEqual(["ha", "bak"]);
  });

  it("빈 팀이면 null(설정 없음)", async () => {
    expect(await getFines(2026, "tEmpty")).toBeNull();
  });
});
