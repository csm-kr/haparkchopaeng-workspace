import { prisma } from "@/lib/prisma";

// 라이브 사용량 추정 (서버 전용, ADR-024). 관리자 콘솔(/admin)이 소비한다.
// 단위는 참가자-분 — LiveKit 과금 개념과 같다(4명 × 30분 = 120분).
// CRITICAL: 이 값은 추정치다. UI에 반드시 "추정치"로 표기한다.
//   ① 재참가가 Participant 행을 덮어써(leftAt=null) 이전 체류 구간이 소실된다 → 과소집계.
//   ② 탭을 닫으면 /leave가 안 불려 leftAt이 null로 남는다 → endedAt으로 보정(과대집계 가능).
//   정확한 값이 필요하면 LiveKit Analytics API 연동을 별도로 검토한다.
// CRITICAL: 월 경계는 KST 1일 00:00(lib/rate-limit.ts의 주간 경계와 같은 방식).
//   월을 걸친 세션은 joinedAt이 속한 달에 전액 귀속한다 — 분할하지 않는다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // KST = UTC+9
const DEFAULT_LIVE_MINUTES_QUOTA = 1000; // LiveKit 무료 한도

export interface ParticipantSpan {
  joinedAt: Date;
  leftAt: Date | null;
  session: { endedAt: Date | null; teamId: string };
}

export interface LiveUsage {
  usedMinutes: number;
  limitMinutes: number;
  remainingMinutes: number;
  byTeam: { teamId: string; teamName: string; minutes: number }[];
}

/** monthsAgo개월 전 1일 00:00 KST의 UTC 순간. 0이면 이번 달. */
export function startOfMonthKSTAgo(monthsAgo: number, now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  // 음수 월은 Date.UTC가 연도까지 정규화한다.
  const firstKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - monthsAgo, 1);
  return new Date(firstKst - KST_OFFSET_MS);
}

/** 이번 달 시작(1일 00:00 KST)의 UTC 순간. 경계는 포함. */
export function startOfMonthKST(now: Date = new Date()): Date {
  return startOfMonthKSTAgo(0, now);
}

/** KST 기준 "YYYY-MM". */
export function monthKeyKST(at: Date): string {
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 월 라이브 한도(분). 미설정/오류면 1000. 호출 시점에 env를 읽는다(R2). */
export function liveMinutesQuota(): number {
  const raw = process.env.LIVE_MINUTES_QUOTA;
  if (raw === undefined || raw === "") return DEFAULT_LIVE_MINUTES_QUOTA;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LIVE_MINUTES_QUOTA;
}

/** 참가자 한 명의 체류 분(추정). leftAt → endedAt → now 순으로 끝을 정하고 음수는 0. */
export function spanMinutes(p: ParticipantSpan, now: Date): number {
  const end = p.leftAt ?? p.session.endedAt ?? now;
  const ms = end.getTime() - p.joinedAt.getTime();
  return ms <= 0 ? 0 : Math.round(ms / 60_000);
}

/** since 이후 joinedAt을 가진 참가자 구간(세션의 endedAt·teamId 포함). */
async function spansSince(since: Date): Promise<ParticipantSpan[]> {
  return prisma.participant.findMany({
    where: { joinedAt: { gte: since } },
    select: {
      joinedAt: true,
      leftAt: true,
      session: { select: { endedAt: true, teamId: true } },
    },
  });
}

/** 이번 달(KST) 참가자-분 추정 + 팀별 분해. byTeam은 많이 쓴 팀부터. */
export async function currentMonthUsage(now: Date = new Date()): Promise<LiveUsage> {
  const spans = await spansSince(startOfMonthKST(now));

  const perTeam = new Map<string, number>();
  let usedMinutes = 0;
  for (const s of spans) {
    const m = spanMinutes(s, now);
    usedMinutes += m;
    perTeam.set(s.session.teamId, (perTeam.get(s.session.teamId) ?? 0) + m);
  }

  const teamIds = [...perTeam.keys()];
  const teams = teamIds.length
    ? await prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(teams.map((t) => [t.id, t.name]));

  const limitMinutes = liveMinutesQuota();
  return {
    usedMinutes,
    limitMinutes,
    remainingMinutes: Math.max(0, limitMinutes - usedMinutes),
    byTeam: [...perTeam.entries()]
      .map(([teamId, minutes]) => ({
        teamId,
        teamName: nameById.get(teamId) ?? "(삭제된 팀)",
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}

/** 최근 months개월 추이. 오래된 달 → 최근 달 순, 사용 없는 달도 0으로 채운다. */
export async function monthlyTrend(
  months: number,
  now: Date = new Date(),
): Promise<{ month: string; minutes: number }[]> {
  const byMonth = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    byMonth.set(monthKeyKST(startOfMonthKSTAgo(i, now)), 0);
  }

  const spans = await spansSince(startOfMonthKSTAgo(months - 1, now));
  for (const s of spans) {
    const key = monthKeyKST(s.joinedAt);
    const prev = byMonth.get(key);
    if (prev !== undefined) byMonth.set(key, prev + spanMinutes(s, now));
  }

  return [...byMonth.entries()].map(([month, minutes]) => ({ month, minutes }));
}
