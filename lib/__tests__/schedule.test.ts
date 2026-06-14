import { describe, expect, it } from "vitest";
import {
  currentWeekIndex,
  deriveFineSummary,
  draftMonth,
  ensureVersion,
  isBreakWeek,
  nextPointer,
  saturdaysOf,
} from "@/lib/schedule-logic";
import { HttpError } from "@/lib/http";

// 스케줄 순수 로직 — 순번 배정·파생 벌금·낙관적 락(409). prisma 불필요.
// 로테이션은 실제 멤버 id 배열을 인자로 받는다(하드코딩 없음).
const R4 = ["ha", "bak", "jo", "paeng"];

describe("saturdaysOf", () => {
  it("2026년 7월의 토요일 4개를 'M월 D일'로 돌려준다", () => {
    expect(saturdaysOf(2026, 7)).toEqual([
      "7월 4일",
      "7월 11일",
      "7월 18일",
      "7월 25일",
    ]);
  });

  it("토요일이 5개인 달도 모두 잡는다", () => {
    // 2026년 8월: 1, 8, 15, 22, 29 (토)
    expect(saturdaysOf(2026, 8)).toHaveLength(5);
  });
});

describe("draftMonth (순번 배정)", () => {
  it("startIdx부터 로테이션 순서로 발표자를 배정하고, 주제는 비우고 미확정으로 둔다", () => {
    const weeks = draftMonth(2026, 7, 1, R4);
    // startIdx=1 → bak, jo, paeng, ha
    expect(weeks.map((w) => w.presenterId)).toEqual([
      "bak",
      "jo",
      "paeng",
      "ha",
    ]);
    expect(weeks.map((w) => w.week)).toEqual([1, 2, 3, 4]);
    expect(weeks.every((w) => w.topic === "")).toBe(true);
    expect(weeks.every((w) => w.confirmed === false)).toBe(true);
    expect(weeks.every((w) => w.status === "upcoming")).toBe(true);
  });

  it("startIdx 0은 첫 멤버부터 시작한다(로테이션 순환)", () => {
    expect(draftMonth(2026, 7, 0, R4).map((w) => w.presenterId)).toEqual([
      "ha",
      "bak",
      "jo",
      "paeng",
    ]);
  });

  it("멤버 4명·토요일 5개면 1~4주 배정, 5주차는 방학(발표자 없음)", () => {
    // 2026년 8월: 토요일 5개 → 멤버 수(4)를 넘는 5주차 방학
    const weeks = draftMonth(2026, 8, 0, R4);
    expect(weeks).toHaveLength(5);
    expect(weeks.map((w) => w.presenterId)).toEqual([
      "ha",
      "bak",
      "jo",
      "paeng",
      null, // 5주차 방학
    ]);
    expect(weeks[4].topic).toBe("방학");
  });

  it("멤버 수가 가변이어도 그 수만큼만 배정하고 자투리 주는 방학", () => {
    // 멤버 2명·토요일 5개 → 1~2주 배정, 3~5주차 방학
    const weeks = draftMonth(2026, 8, 0, ["a", "b"]);
    expect(weeks.map((w) => w.presenterId)).toEqual([
      "a",
      "b",
      null,
      null,
      null,
    ]);
    expect(weeks.slice(2).every((w) => w.topic === "방학")).toBe(true);
  });

  it("멤버가 없으면 모든 주차에 발표자가 없다", () => {
    const weeks = draftMonth(2026, 7, 0, []);
    expect(weeks.every((w) => w.presenterId === null)).toBe(true);
  });
});

describe("isBreakWeek (자투리 주 방학)", () => {
  it("로테이션 한 바퀴(멤버 수)를 넘는 주차는 방학", () => {
    expect(isBreakWeek(5, 4)).toBe(true); // 멤버 4명, 5주차
    expect(isBreakWeek(4, 4)).toBe(false); // 딱 한 바퀴
    expect(isBreakWeek(4, 5)).toBe(false); // 멤버 5명, 4주차는 방학 아님
    expect(isBreakWeek(3, 2)).toBe(true); // 멤버 2명, 3주차
  });

  it("멤버가 없으면(rotationLen 0) 방학 판정하지 않는다", () => {
    expect(isBreakWeek(1, 0)).toBe(false);
  });
});

describe("nextPointer (순번 전진)", () => {
  it("4주차 4인 로테이션이면 한 바퀴 돌아 같은 인덱스로", () => {
    expect(nextPointer(1, 4, R4.length)).toBe(1);
  });

  it("5주차면 한 칸 전진한다", () => {
    expect(nextPointer(0, 5, R4.length)).toBe(1);
  });
});

describe("currentWeekIndex (파생 current)", () => {
  it("첫 비-done 주차의 인덱스를 돌려준다", () => {
    expect(
      currentWeekIndex([
        { status: "done" },
        { status: "done" },
        { status: "upcoming" },
        { status: "upcoming" },
      ]),
    ).toBe(2);
  });

  it("모두 done이면 -1", () => {
    expect(currentWeekIndex([{ status: "done" }])).toBe(-1);
  });
});

describe("deriveFineSummary (누적 벌금·미납 파생)", () => {
  it("누적 = 발표자불참*발표벌금 + 일반불참*일반벌금, 미납 = 누적 - 납부", () => {
    const sum = deriveFineSummary(
      { memberId: "jo", missedPresenter: 1, missedAbsent: 1, paid: 30000 },
      30000,
      10000,
    );
    expect(sum.accruedFine).toBe(40000);
    expect(sum.outstanding).toBe(10000);
  });

  it("납부가 누적 이상이면 미납은 ≤0 (완납)", () => {
    const sum = deriveFineSummary(
      { memberId: "ha", missedPresenter: 0, missedAbsent: 1, paid: 10000 },
      30000,
      10000,
    );
    expect(sum.accruedFine).toBe(10000);
    expect(sum.outstanding).toBe(0);
  });
});

describe("ensureVersion (낙관적 락)", () => {
  it("version이 다르면 409 HttpError를 던진다", () => {
    try {
      ensureVersion(5, 3);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(409);
    }
  });

  it("version이 같으면 통과한다", () => {
    expect(() => ensureVersion(3, 3)).not.toThrow();
  });
});
