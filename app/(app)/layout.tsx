import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActiveSession } from "@/lib/live";
import { listMemberships, listTeamMembers } from "@/lib/teams";
import { getActiveTeam } from "@/lib/active-team";
import { needsTeamOnboarding } from "@/lib/redirect";
import { AppProviders } from "@/components/providers";
import { AppShell, type ShellMember } from "@/components/shell";

// 셸 안쪽 화면들의 RSC 레이아웃.
// CRITICAL: 데이터 읽기는 서버에서(ADR-015) — 멤버·세션을 Prisma로 직접 조회한다.
// 미인증이면 로그인(홈)으로 보낸다(권한 체크는 서버에서, R19).
// 팀 없음이면 팀 허브로 보낸다(ADR-021/018). /teams는 (app) 밖이라 이 가드를 타지 않는다.

function toShellMember(m: {
  id: string;
  name: string;
  initial: string;
  color: string;
  role: string;
  status: string | null;
}): ShellMember {
  return {
    id: m.id,
    name: m.name,
    initial: m.initial,
    color: m.color,
    role: m.role,
    status: m.status,
  };
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const current = await prisma.member.findUnique({
    where: { id: session.memberId },
  });
  if (!current) redirect("/");

  // 팀 없음 진입 가드(ADR-021/018). 멤버십이 없으면 팀 허브(/teams)로 보낸다.
  // pathname은 미들웨어가 x-pathname 헤더로 노출한다(RSC 레이아웃은 경로를 직접 못 받는다).
  const teams = await listMemberships(session.memberId);
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (needsTeamOnboarding(pathname, teams.length > 0)) {
    redirect("/teams");
  }

  // 활성 팀 해소(ADR-020/R37) — 쿠키가 내 멤버십이면 그걸, 아니면 최근 합류로 폴백.
  const activeTeam = await getActiveTeam(session.memberId);

  // 셸 로스터는 활성 팀 멤버만 보인다(ADR-020/R37) — 전역 Member 전체가 아니라 멤버십 기준.
  const roster = activeTeam ? await listTeamMembers(activeTeam.id) : [];

  // 현재 live 여부를 활성 팀으로 스코핑해 첫 렌더부터 일관되게(ADR-001/R37). 이후 전이는 Realtime.
  const active = activeTeam ? await getActiveSession(activeTeam.id) : null;

  return (
    <AppProviders initialLive={!!active} activeTeamId={activeTeam?.id ?? null}>
      <AppShell
        members={roster.map((m) => ({
          id: m.id,
          name: m.name,
          initial: m.initial,
          color: m.color,
          role: m.role,
          status: null,
        }))}
        currentUser={toShellMember(current)}
        teams={teams.map((t) => ({ slug: t.slug, name: t.name }))}
        activeTeamSlug={activeTeam?.slug ?? null}
      >
        {children}
      </AppShell>
    </AppProviders>
  );
}
