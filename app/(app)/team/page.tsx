import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import { TeamManager } from "@/components/team";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, listTeamMembers, resolveEntryTeam } from "@/lib/teams";
import { listActiveInvites } from "@/lib/invite";

// 팀 관리 — RSC(ADR-015/R32). 멀티팀(ADR-018): 활성 팀(진입 팀)의 멤버십·초대를 서버에서 직접 조회.
// CRITICAL: 관리 액션은 멤버 관리 route handler가 멤버십 역할로 최종 강제(R19). UI 게이팅은 보조.
// 활성 팀 = 진입 팀(가장 최근 합류). 진짜 팀 전환은 팀 스코핑 단계에서 배선(ADR-018 범위).

function errorCard() {
  return (
    <div className="p-6">
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-[15px] font-semibold text-fg">팀 정보를 불러오지 못했어요.</p>
        <p className="max-w-sm text-[13px] text-fg-muted">잠깐 후 다시 시도해주세요.</p>
        <a
          href="/team"
          className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
        >
          다시 시도
        </a>
      </Card>
    </div>
  );
}

export default async function TeamPage() {
  const session = await getSession();
  const currentUserId = session?.memberId ?? "";

  let body: React.ReactNode;
  try {
    // 진입 팀 해소(팀 없음은 (app)/layout이 /teams 허브로 가드 — 여기선 방어적으로만).
    const entry = currentUserId ? await resolveEntryTeam(currentUserId) : null;
    const team = entry ? await prisma.team.findUnique({ where: { slug: entry.slug } }) : null;
    if (!team) throw new Error("no active team");

    const viewer = await getMembership(team.id, currentUserId);
    const currentUserRole = viewer?.role ?? "member";
    const canManage = currentUserRole === "owner" || currentUserRole === "admin";

    const members = await listTeamMembers(team.id);
    const invites = canManage ? await listActiveInvites(team.id) : [];

    body = (
      <TeamManager
        teamSlug={team.slug}
        members={members}
        invites={invites}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
      />
    );
  } catch {
    // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
    body = errorCard();
  }

  return (
    <>
      <Topbar crumbs={[{ label: "팀 관리" }]} />
      <div className="flex-1 overflow-y-auto">{body}</div>
    </>
  );
}
