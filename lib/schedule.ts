import { prisma } from "@/lib/prisma";
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

/** 해당 월 조회. 없으면 null(빈 달) — 절대 row를 생성하지 않는다(R15/ADR-006). */
export async function getMonth(
  year: number,
  month: number,
  teamId: string,
): Promise<ScheduleMonthView | null> {
  // CRITICAL: 활성 팀으로 스코핑(R37/ADR-020) — 복합 unique [teamId, year, month] 중 teamId까지 필터.
  // 다른 팀의 같은 달이 섞이지 않는다.
  const m = await prisma.scheduleMonth.findFirst({
    where: { teamId, year, month },
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

/** 발표자 선택·로테이션 표시에 쓸 멤버(가입순 = 로테이션 순서). */
export async function getScheduleMembers(): Promise<MemberOption[]> {
  const members = await prisma.member.findMany({
    // 로테이션 순서(iteration)가 지정된 멤버 우선, 미지정(null)은 가입순으로 뒤에.
    orderBy: [
      { rotationOrder: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    select: {
      id: true,
      name: true,
      initial: true,
      color: true,
      availability: true,
    },
  });
  return members.map((m) => ({
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
export async function getFines(
  year: number,
  teamId: string,
): Promise<FinesView | null> {
  // CRITICAL: 활성 팀으로 스코핑(R37/ADR-020) — PK [teamId, year] 중 teamId까지 필터.
  // 다른 팀의 같은 연도 벌금 설정이 섞이지 않는다.
  const config = await prisma.fineConfig.findFirst({
    where: { teamId, year },
    include: { ledgers: true },
  });
  if (!config) return null;

  const members = await prisma.member.findMany({
    // 로테이션과 동일 순서(iteration 우선, 미지정은 가입순) — 장부 표도 같은 정렬.
    orderBy: [
      { rotationOrder: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    select: { id: true, name: true, initial: true, color: true },
  });
  const ledgerByMember = new Map(config.ledgers.map((l) => [l.memberId, l]));

  const rows: MemberLedgerRow[] = members.map((m) => {
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
 * 새 달 초안·저장의 시작 순번 — 같은 팀의 직전 저장된 달의 rotationPointerAfter(없으면 0).
 * 클라이언트가 포인터를 보내지 않는다 — 서버에서 취한다(R16).
 * CRITICAL: 활성 팀으로 스코핑(R37/ADR-020) — 다른 팀의 저장월이 순번에 끼어들지 않는다.
 */
export async function resolveStartIdx(
  year: number,
  month: number,
  teamId: string,
): Promise<number> {
  const prev = await prisma.scheduleMonth.findFirst({
    where: {
      teamId,
      saved: true,
      OR: [{ year: { lt: year } }, { year, month: { lt: month } }],
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { rotationPointerAfter: true },
  });
  return prev?.rotationPointerAfter ?? 0;
}
