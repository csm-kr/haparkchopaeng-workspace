import { describe, expect, it } from "vitest";
import {
  ROTATION,
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
    const weeks = draftMonth(2026, 7, 1);
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

  it("startIdx 0은 ha부터 시작한다(로테이션 순환)", () => {
    expect(draftMonth(2026, 7, 0).map((w) => w.presenterId)).toEqual([
      "ha",
      "bak",
      "jo",
      "paeng",
    ]);
  });

  it("5주가 있는 달은 1~4주 ha~paeng, 5주차는 방학(발표자 없음)", () => {
    // 2026년 8월: 토요일 5개 → 5주차 방학
    const weeks = draftMonth(2026, 8, 0);
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
});

describe("isBreakWeek (5주차 방학)", () => {
  it("토요일 5개인 달의 5주차만 방학", () => {
    expect(isBreakWeek(5, 5)).toBe(true);
    expect(isBreakWeek(4, 5)).toBe(false);
    expect(isBreakWeek(4, 4)).toBe(false); // 4주 달엔 방학 없음
  });
});

describe("nextPointer (순번 전진)", () => {
  it("4주차 4인 로테이션이면 한 바퀴 돌아 같은 인덱스로", () => {
    expect(nextPointer(1, 4, ROTATION.length)).toBe(1);
  });

  it("5주차면 한 칸 전진한다", () => {
    expect(nextPointer(0, 5, ROTATION.length)).toBe(1);
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
