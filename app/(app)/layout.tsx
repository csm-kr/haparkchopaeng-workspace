import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActiveSession } from "@/lib/live";
import { listMemberships } from "@/lib/teams";
import { needsTeamOnboarding } from "@/lib/redirect";
import { AppProviders } from "@/components/providers";
import { AppShell, type ShellMember } from "@/components/shell";

// 셸 안쪽 화면들의 RSC 레이아웃.
// CRITICAL: 데이터 읽기는 서버에서(ADR-015) — 멤버·세션을 Prisma로 직접 조회한다.
// 미인증이면 로그인(홈)으로 보낸다(권한 체크는 서버에서, R19).
// 팀 없음이면 팀 만들기로 보낸다(ADR-018) — /teams/new는 예외(무한 루프 방지).

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

  const members = await prisma.member.findMany({ orderBy: { createdAt: "asc" } });
  const current = members.find((m) => m.id === session.memberId);
  if (!current) redirect("/");

  // 팀 없음 진입 가드(ADR-018). 멤버십이 없으면 팀 만들기로(단, /teams/new 자신은 예외 → 루프 방지).
  // pathname은 미들웨어가 x-pathname 헤더로 노출한다(RSC 레이아웃은 경로를 직접 못 받는다).
  const teams = await listMemberships(session.memberId);
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (needsTeamOnboarding(pathname, teams.length > 0)) {
    redirect("/teams/new");
  }

  // 현재 live 여부를 서버에서 구해 첫 렌더부터 일관되게(ADR-001). 이후 전이는 Realtime.
  const active = await getActiveSession();

  return (
    <AppProviders initialLive={!!active}>
      <AppShell
        members={members.map(toShellMember)}
        currentUser={toShellMember(current)}
        teams={teams.map((t) => ({ slug: t.slug, name: t.name }))}
        activeTeamSlug={teams[0]?.slug ?? null}
      >
        {children}
      </AppShell>
    </AppProviders>
  );
}
