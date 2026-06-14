import { HttpError } from "@/lib/http";
import type { MemberFineSummary, WeekStatus } from "@/types";
import type { ScheduleWeekView } from "@/components/schedule/types";

// 스케줄 순수 로직 — prisma를 import하지 않는다(클라이언트 섬도 안전하게 쓰도록).
// 서버 조회(lib/schedule.ts)와 Server Action(actions.ts)이 이 함수들을 재사용한다.

// 로테이션 순서는 실제 멤버(가입순)로 결정한다 — 하드코딩하지 않는다.
// lib/schedule.ts가 createdAt asc로 멤버를 읽어 호출부(actions)에 넘긴다.

/** 해당 연·월의 모든 토요일을 "M월 D일" 문자열 배열로. (UTC가 아니라 로컬 달력 기준) */
export function saturdaysOf(year: number, month: number): string[] {
  const dates: string[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() === 6) dates.push(`${month}월 ${d.getDate()}일`);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/**
 * 로테이션 한 바퀴(rotationLen 주)를 넘는 자투리 주는 방학 — 발표 없음.
 * 예) 멤버 4명·토요일 5개 → 1~4주 발표, 5주차 방학.
 */
export function isBreakWeek(week: number, rotationLen: number): boolean {
  return rotationLen > 0 && week > rotationLen;
}

/**
 * 빈 달의 초안을 만든다 — 1주차부터 startIdx 순번으로 rotation(멤버 id)을 배정.
 * 멤버 수를 넘는 자투리 주는 방학(발표자 없음). CRITICAL: 순수 계산, DB 저장 안 함(초안, R16/ADR-006).
 */
export function draftMonth(
  year: number,
  month: number,
  startIdx: number,
  rotation: readonly string[],
): ScheduleWeekView[] {
  const len = rotation.length;
  const saturdays = saturdaysOf(year, month);
  return saturdays.map((date, i) => {
    const week = i + 1;
    const brk = isBreakWeek(week, len);
    return {
      week,
      date,
      time: "10:00",
      presenterId: brk || len === 0 ? null : (rotation[(startIdx + i) % len] ?? null),
      topic: brk ? "방학" : "",
      confirmed: false,
      status: "upcoming" as WeekStatus,
      presentationId: null,
    };
  });
}

/** 저장 후 다음 달이 시작할 순번 인덱스. (start + 이번 달 주차수) % 멤버수 */
export function nextPointer(
  startIdx: number,
  count: number,
  rotationLen: number,
): number {
  if (rotationLen <= 0) return 0;
  return (((startIdx + count) % rotationLen) + rotationLen) % rotationLen;
}

/** current(이번 주)는 파생 — 첫 비-done 주차의 인덱스. 모두 done이거나 비어 있으면 -1. */
export function currentWeekIndex(weeks: Array<{ status: WeekStatus }>): number {
  return weeks.findIndex((w) => w.status !== "done");
}

/**
 * 멤버 벌금 파생값(저장 안 함, DB.md).
 * accruedFine = missedPresenter*finePresenter + missedAbsent*fineAbsent
 * outstanding = accruedFine - paid (≤0이면 완납)
 */
export function deriveFineSummary(
  ledger: {
    memberId: string;
    missedPresenter: number;
    missedAbsent: number;
    paid: number;
  },
  finePresenter: number,
  fineAbsent: number,
): MemberFineSummary {
  const accruedFine =
    ledger.missedPresenter * finePresenter + ledger.missedAbsent * fineAbsent;
  return {
    memberId: ledger.memberId,
    accruedFine,
    outstanding: accruedFine - ledger.paid,
  };
}

/**
 * 낙관적 락 — 저장 시점의 현재 version과 클라가 들고 있던 version이 다르면 409(R35).
 * "다른 사람이 먼저 저장했어요" — 사용자에게는 따뜻한 한국어로(R30).
 */
export function ensureVersion(current: number, expected: number): void {
  if (current !== expected) {
    throw new HttpError(
      409,
      "CONFLICT",
      "다른 사람이 먼저 저장했어요. 새로고침 후 다시 시도해주세요.",
    );
  }
}
