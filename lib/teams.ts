import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { maxTeams } from "@/lib/settings";
import type { TeamRole } from "@/types";

// 팀 생성 도메인 (서버 전용, ADR-018). 권한은 RLS 없이 앱레벨에서 강제(ADR-016/R19).
// CRITICAL: 전역 팀 상한은 서버 전체 team.count() 기준(per-user 아님). creatorId는 호출부(세션)에서 취한다(R3).
// CRITICAL: 상한값은 lib/settings.ts가 소유한다(DB > env > 2, ADR-023). 여기서 env를 직접 읽지 마라.
// 기존 lib/team.ts(단일 워크스페이스 조회)와는 별개 — 이건 멀티팀용이다.

const SLUG_RE = /^[a-z][a-z0-9-]{1,23}$/;

/** 전역 팀 생성 가능 여부 — 서버 전체 team.count()가 maxTeams() 미만이면 true. (per-user 아님, ADR-021) */
export async function canCreateTeam(): Promise<boolean> {
  return (await prisma.team.count()) < (await maxTeams());
}

/** 이름 → slug 후보. 영문 소문자/숫자만 남기고 그 외는 하이픈으로. 형식에 못 맞으면 "team" 폴백. */
function slugify(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // 허용 외 문자(공백·한글 등)는 하이픈으로
    .replace(/^-+|-+$/g, "") // 양끝 하이픈 제거
    .slice(0, 24);
  // 첫 글자가 영문이 아니거나(숫자/하이픈 시작) 너무 짧으면 폴백.
  if (!SLUG_RE.test(s)) s = "team";
  return s;
}

/** base slug가 비면 비, 충돌하면 -2,-3… 으로 회피해 사용 가능한 slug를 찾는다(자동 생성 경로). */
async function uniqueSlug(base: string): Promise<string> {
  if (!(await slugTaken(base))) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base.slice(0, 24 - `-${i}`.length)}-${i}`;
    if (!(await slugTaken(candidate))) return candidate;
  }
}

async function slugTaken(slug: string): Promise<boolean> {
  return (await prisma.team.findUnique({ where: { slug } })) !== null;
}

/**
 * 팀 생성 + 생성자를 owner 멤버십으로(원자적). 전역 상한·이름/slug 검증을 앱레벨에서 강제한다.
 * 성공 시 { id, slug }. 실패는 HttpError(400 검증 / 403 상한 / 409 slug 중복)로 던진다.
 */
export async function createTeam(input: {
  name: string;
  slug?: string;
  creatorId: string;
}): Promise<{ id: string; slug: string }> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 30) {
    throw new HttpError(400, "INVALID_NAME", "팀 이름은 2–30자로 입력해주세요.");
  }

  // 전역 상한(서버 전체) — 1차 확인. 트랜잭션 안에서 count→insert race를 재확인한다.
  if ((await prisma.team.count()) >= (await maxTeams())) {
    throw new HttpError(403, "TEAM_LIMIT", "최대 팀 수를 초과했어요.");
  }

  let slug: string;
  if (input.slug !== undefined) {
    slug = input.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      throw new HttpError(400, "INVALID_SLUG", "주소는 영문 소문자로 시작하는 2–24자여야 해요.");
    }
    if (await slugTaken(slug)) {
      throw new HttpError(409, "SLUG_TAKEN", "이미 사용 중인 주소예요.");
    }
  } else {
    slug = await uniqueSlug(slugify(name));
  }

  return prisma.$transaction(async (tx) => {
    if ((await tx.team.count()) >= (await maxTeams())) {
      throw new HttpError(403, "TEAM_LIMIT", "최대 팀 수를 초과했어요.");
    }
    const team = await tx.team.create({
      data: { name, slug, createdBy: input.creatorId },
    });
    // 팀엔 owner ≥ 1 — 생성자는 반드시 owner로(ADR-018, owner는 초대 부여 불가).
    await tx.membership.create({
      data: { teamId: team.id, memberId: input.creatorId, role: "owner" satisfies TeamRole },
    });
    return { id: team.id, slug: team.slug };
  });
}

/** DB의 role(String)을 TeamRole로 좁힌다(허용값은 생성/검증으로 보장). */
function toTeamRole(value: string): TeamRole {
  return value === "owner" || value === "admin" ? value : "member";
}

/** 팀 내 멤버의 역할. 멤버십이 없으면 null. (앱레벨 권한 체크의 기반) */
export async function getMembership(
  teamId: string,
  memberId: string,
): Promise<{ role: TeamRole } | null> {
  const m = await prisma.membership.findUnique({
    where: { teamId_memberId: { teamId, memberId } },
  });
  return m ? { role: toTeamRole(m.role) } : null;
}

/** 팀 소속 여부. */
export async function isTeamMember(teamId: string, memberId: string): Promise<boolean> {
  return (await getMembership(teamId, memberId)) !== null;
}

/** admin 이상(owner+admin). 위계 owner>admin>member. */
export async function isTeamAdmin(teamId: string, memberId: string): Promise<boolean> {
  const m = await getMembership(teamId, memberId);
  return m !== null && (m.role === "owner" || m.role === "admin");
}

/** owner 여부. */
export async function isTeamOwner(teamId: string, memberId: string): Promise<boolean> {
  const m = await getMembership(teamId, memberId);
  return m?.role === "owner";
}

/** 진입 해소 — 멤버십이 있으면 가장 최근 joinedAt 팀의 slug, 없으면 null(= 팀 없음). */
export async function resolveEntryTeam(memberId: string): Promise<{ slug: string } | null> {
  const m = await prisma.membership.findFirst({
    where: { memberId },
    orderBy: { joinedAt: "desc" },
    include: { team: true },
  });
  return m ? { slug: m.team.slug } : null;
}

/** 셸 팀 전환용 요약. */
export interface TeamSummary {
  slug: string;
  name: string;
  role: TeamRole;
}

/** 사용자가 속한 모든 팀을 최근 합류 순으로(= [0]이 진입 팀). 멤버십 없으면 빈 배열. */
export async function listMemberships(memberId: string): Promise<TeamSummary[]> {
  const rows = await prisma.membership.findMany({
    where: { memberId },
    orderBy: { joinedAt: "desc" },
    include: { team: true },
  });
  return rows.map((m) => ({ slug: m.team.slug, name: m.team.name, role: toTeamRole(m.role) }));
}

/** 팀 관리 화면용 멤버 행 — 멤버십 역할 + Member 표시 정보. */
export interface TeamMemberRow {
  id: string; // Member.id
  name: string;
  handle: string;
  email: string;
  color: string;
  initial: string;
  role: TeamRole;
}

/**
 * 팀과 그 팀에 속한 모든 데이터를 삭제한다(원자적). Membership·Invite는 Team FK(onDelete: Cascade)로,
 * Paper/Presentation/ScheduleMonth/LiveSession의 자식들은 각자의 FK cascade로 자동 정리된다.
 * teamId만 가진(FK 없는) 테이블은 여기서 수동 삭제한다.
 * CRITICAL: MemberLedger는 FineConfig의 required 관계 자식(기본 Restrict)이라 FineConfig보다 먼저 지운다.
 * Out: Supabase 스토리지 파일·Job(payload.paperId)은 지우지 않는다(DB-only, 합의된 범위).
 */
export async function deleteTeam(teamId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.memberLedger.deleteMany({ where: { teamId } });
    await tx.fineConfig.deleteMany({ where: { teamId } });
    await tx.paper.deleteMany({ where: { teamId } }); // → Analysis·Figure·SectionNote cascade
    await tx.presentation.deleteMany({ where: { teamId } }); // → Asset·Version·Comment→Reaction cascade
    await tx.scheduleMonth.deleteMany({ where: { teamId } }); // → ScheduleWeek cascade
    await tx.liveSession.deleteMany({ where: { teamId } }); // → Participant cascade
    await tx.teamInviteAcceptance.deleteMany({ where: { teamId } }); // 관계 없음 — 수동
    await tx.team.delete({ where: { id: teamId } }); // → Membership·Invite cascade
  });
}

/** 한 팀의 멤버 목록(합류 순). 멤버십 ⨝ Member. 관리 화면이 props로 받는다(ADR-015/R32). */
export async function listTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
  const memberships = await prisma.membership.findMany({
    where: { teamId },
    orderBy: { joinedAt: "asc" },
  });
  const members = await prisma.member.findMany({
    where: { id: { in: memberships.map((m) => m.memberId) } },
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  return memberships.map((ms) => {
    const m = byId.get(ms.memberId);
    return {
      id: ms.memberId,
      name: m?.name ?? ms.memberId,
      handle: m?.handle ?? "",
      email: m?.email ?? "",
      color: m?.color ?? "var(--m-jo)",
      initial: m?.initial ?? "?",
      role: toTeamRole(ms.role),
    };
  });
}
