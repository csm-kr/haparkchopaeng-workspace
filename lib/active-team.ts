import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { getMembership, isTeamMember, resolveEntryTeam } from "@/lib/teams";
import type { TeamRole } from "@/types";

// 활성 팀 컨텍스트 (서버 전용, ADR-020/R37). 멤버십으로 검증한 활성 팀을 쿠키로 영속화한다.
// CRITICAL: 쿠키 값은 멤버십 검증 후에만 신뢰한다(R3/R19) — 임의 slug로 다른 팀을 활성화하면 격리가 깨진다.
// 무효/미설정 쿠키는 resolveEntryTeam(최근 합류)으로 폴백. 도메인 쿼리 스코핑은 여기서 하지 않는다(step 3/4).

const ACTIVE_TEAM_COOKIE = "active_team";
const ACTIVE_TEAM_TTL_SEC = 60 * 60 * 24 * 365; // 1년 — 활성 팀 선택은 오래 유지

/** slug가 memberId의 멤버십인지(존재하는 팀이면서 소속) — 신뢰 경계 검증의 핵심. */
async function isMyTeamSlug(memberId: string, slug: string): Promise<boolean> {
  const team = await prisma.team.findUnique({ where: { slug } });
  if (!team) return false;
  return isTeamMember(team.id, memberId);
}

/**
 * 활성 팀 slug를 해소한다: 쿠키 값이 내 멤버십이면 그걸, 아니면 resolveEntryTeam(최근 합류).
 * 팀이 없으면 null. 쿠키는 검증 후에만 신뢰한다(R3/R19).
 */
export async function getActiveTeamSlug(memberId: string): Promise<string | null> {
  const store = await cookies();
  const cookieSlug = store.get(ACTIVE_TEAM_COOKIE)?.value;
  if (cookieSlug && (await isMyTeamSlug(memberId, cookieSlug))) {
    return cookieSlug;
  }
  const entry = await resolveEntryTeam(memberId);
  return entry?.slug ?? null;
}

/**
 * 활성 팀의 { id, slug, role } 해소(스코핑 쿼리가 쓸 teamId까지). 멤버십이 아니면 null.
 * slug → Team.id 해소 + 역할은 멤버십에서 가져온다.
 */
export async function getActiveTeam(
  memberId: string,
): Promise<{ id: string; slug: string; role: TeamRole } | null> {
  const slug = await getActiveTeamSlug(memberId);
  if (!slug) return null;
  const team = await prisma.team.findUnique({ where: { slug } });
  if (!team) return null;
  const membership = await getMembership(team.id, memberId);
  if (!membership) return null;
  return { id: team.id, slug: team.slug, role: membership.role };
}

/**
 * 활성 팀 쿠키를 설정한다 — slug가 memberId의 멤버십일 때만. 아니면 403으로 거부한다(R19).
 * HttpOnly·SameSite=Lax(세션 쿠키와 동일 정책).
 */
export async function setActiveTeam(memberId: string, slug: string): Promise<void> {
  if (!(await isMyTeamSlug(memberId, slug))) {
    throw new HttpError(403, "FORBIDDEN", "그 팀의 멤버가 아니에요.");
  }
  const store = await cookies();
  store.set(ACTIVE_TEAM_COOKIE, slug, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACTIVE_TEAM_TTL_SEC,
  });
}
