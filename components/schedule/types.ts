import type { Availability, WeekStatus } from "@/types";

// 스케줄 화면 뷰 DTO — DB 모델(ScheduleMonth/ScheduleWeek/FineConfig/MemberLedger)을
// 화면용으로 좁힌 것. 읽기는 RSC가 props로 내려보낸다(ADR-015). papers.ts와 동일 패턴.

/** 확정/편집 행. current 상태는 파생(저장 안 함) — status는 done|upcoming만(DB.md). */
export interface ScheduleWeekView {
  week: number;
  date: string;
  time: string;
  presenterId: string | null;
  topic: string | null;
  confirmed: boolean;
  status: WeekStatus;
  presentationId: string | null;
}

/** 월 보드. version은 낙관적 락에 쓴다(R35). row 부재(빈 달)는 null로 표현(R15). */
export interface ScheduleMonthView {
  year: number;
  month: number;
  day: string;
  rotationPointerAfter: number;
  version: number;
  weeks: ScheduleWeekView[];
}

/** 발표자 선택용 멤버. vacation이면 순번 배정 시 표시(SCREEN_FLOW). */
export interface MemberOption {
  id: string;
  name: string;
  initial: string;
  /** 멤버 색 토큰값 (예: "var(--m-ha)") */
  color: string;
  availability: Availability;
}

/** 연도별 장부 원자료 — 누적/미납은 저장하지 않고 화면에서 파생(DB.md). */
export interface MemberLedgerRow {
  memberId: string;
  name: string;
  initial: string;
  color: string;
  count: number;
  missedPresenter: number;
  missedAbsent: number;
  paid: number;
}

export interface FinesView {
  year: number;
  finePresenter: number;
  fineAbsent: number;
  members: MemberLedgerRow[];
}

/** 장부 편집 입력 — 원자료 4개만 보낸다. 누적/미납은 보내지 않는다(파생, DB.md). teamId는 서버가 활성 팀 주입(R3). */
export interface LedgerRowInput {
  memberId: string;
  count: number;
  missedPresenter: number;
  missedAbsent: number;
  paid: number;
}

/** saveMonth 입력 주차 — 순번 포인터는 보내지 않는다(서버가 원자적으로 계산, R16). */
export interface WeekInput {
  week: number;
  date: string;
  time: string;
  presenterId: string | null;
  topic: string;
  confirmed: boolean;
  status: WeekStatus;
  presentationId: string | null;
}

/** saveMonth 결과 — 낙관적 락 충돌(409)을 client가 다룰 수 있게 판별 유니온으로(R35). */
export type SaveMonthResult =
  | { ok: true; month: ScheduleMonthView }
  | { ok: false; code: "CONFLICT" | "FORBIDDEN" | "ERROR"; message: string };
