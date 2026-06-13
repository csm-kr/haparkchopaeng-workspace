import { prisma } from "@/lib/prisma";
import { ROTATION } from "@/lib/schedule-logic";
import type {
  FinesView,
  MemberLedgerRow,
  MemberOption,
  ScheduleMonthView,
} from "@/components/schedule/types";
import type { Availability, WeekStatus } from "@/types";

// 스케줄 서버 조회 — 읽기는 RSC에서 Prisma 직접(ADR-015/R32). 클라가 fetch하지 않는다.
// CRITICAL: GET이 ScheduleMonth row를 만들지 않는다 — row 부재 = 빈 달(R15/ADR-006).

function toWeekStatus(value: string): WeekStatus {
  return value === "done" ? "done" : "upcoming";
}

function toAvailability(value: string): Availability {
  return value === "vacation" ? "vacation" : "active";
}

/** ROTATION을 먼저, 그 외 멤버는 뒤에 둔 정렬 순서(로테이션·장부 표 공통). */
function orderByRotation<T extends { id: string }>(members: T[]): T[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const ordered: T[] = [];
  for (const id of ROTATION) {
    const m = byId.get(id);
    if (m) {
      ordered.push(m);
      byId.delete(id);
    }
  }
  for (const m of byId.values()) ordered.push(m);
  return ordered;
}

/** 해당 월 조회. 없으면 null(빈 달) — 절대 row를 생성하지 않는다(R15/ADR-006). */
export async function getMonth(
  year: number,
  month: number,
): Promise<ScheduleMonthView | null> {
  const m = await prisma.scheduleMonth.findUnique({
    where: { year_month: { year, month } },
    include: { weeks: { orderBy: { week: "asc" } } },
  });
  if (!m) return null;

  return {
    year: m.year,
    month: m.month,
    day: m.day,
    rotationPointerAfter: m.rotationPointerAfter,
    version: m.version,
    weeks: m.weeks.map((w) => ({
      week: w.week,
      date: w.date,
      time: w.time,
      presenterId: w.presenterId,
      topic: w.topic,
      confirmed: w.confirmed,
      status: toWeekStatus(w.status),
      presentationId: w.presentationId,
    })),
  };
}

/** 발표자 선택·로테이션 표시에 쓸 멤버(로테이션 순서). */
export async function getScheduleMembers(): Promise<MemberOption[]> {
  const members = await prisma.member.findMany({
    select: {
      id: true,
      name: true,
      initial: true,
      color: true,
      availability: true,
    },
  });
  return orderByRotation(members).map((m) => ({
    id: m.id,
    name: m.name,
    initial: m.initial,
    color: m.color,
    availability: toAvailability(m.availability),
  }));
}

/**
 * 연도별 벌금 설정 + 멤버 장부 원자료. 누적/미납은 저장하지 않고 화면에서 파생(DB.md).
 * 해당 연도 설정이 없으면 null.
 */
export async function getFines(year: number): Promise<FinesView | null> {
  const config = await prisma.fineConfig.findUnique({
    where: { year },
    include: { ledgers: true },
  });
  if (!config) return null;

  const members = await prisma.member.findMany({
    select: { id: true, name: true, initial: true, color: true },
  });
  const ledgerByMember = new Map(config.ledgers.map((l) => [l.memberId, l]));

  const rows: MemberLedgerRow[] = orderByRotation(members).map((m) => {
    const l = ledgerByMember.get(m.id);
    return {
      memberId: m.id,
      name: m.name,
      initial: m.initial,
      color: m.color,
      count: l?.count ?? 0,
      missedPresenter: l?.missedPresenter ?? 0,
      missedAbsent: l?.missedAbsent ?? 0,
      paid: l?.paid ?? 0,
    };
  });

  return {
    year: config.year,
    finePresenter: config.finePresenter,
    fineAbsent: config.fineAbsent,
    members: rows,
  };
}

/**
 * 새 달 초안·저장의 시작 순번 — 직전 저장된 달의 rotationPointerAfter(없으면 0).
 * 클라이언트가 포인터를 보내지 않는다 — 서버에서 취한다(R16).
 */
export async function resolveStartIdx(
  year: number,
  month: number,
): Promise<number> {
  const prev = await prisma.scheduleMonth.findFirst({
    where: {
      saved: true,
      OR: [{ year: { lt: year } }, { year, month: { lt: month } }],
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { rotationPointerAfter: true },
  });
  return prev?.rotationPointerAfter ?? 0;
}
