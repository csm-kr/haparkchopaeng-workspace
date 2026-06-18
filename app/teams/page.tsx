import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateTeam, listMemberships } from "@/lib/teams";
import { TeamPicker } from "./team-picker";
import { CreateTeamForm } from "./create-team-form";
import { DeleteTeamSection } from "./delete-team-section";

// 진입 팀 허브(로비) — 로그인 후 착지 화면(ADR-021, SCREENS §teams).
// (app) 셸 밖의 독립 로비 — 사이드바·TeamSwitcher 없음. 데이터 읽기는 서버에서(ADR-015).
// 진입 경로는 둘뿐: 팀 선택(활성 팀 전환) · 팀 만들기/초대 수락(R18). 공개 가입 없음.
// 로그인 후 기본 착지(ADR-021): auth/callback·app/page가 next ?? "/teams"로 여기로 보낸다.
// 삭제 섹션(R19 보조 가시화): 전역 관리자=전체 팀 / 그 외=내가 owner인 팀. 서버 액션이 최종 강제.

export default async function TeamHubPage() {
  const session = await getSession();
  if (!session) redirect("/");

  // 읽기는 서버에서(ADR-015) — 내 팀 목록(최근 합류 순)과 전역 생성 가능 여부.
  const [teams, canCreate] = await Promise.all([
    listMemberships(session.memberId),
    canCreateTeam(),
  ]);

  // 삭제 가능한 팀: 전역 관리자는 전체, 그 외엔 내가 owner인 팀만(서버 액션이 재강제, R19).
  const deletableTeams =
    session.role === "관리자"
      ? (await prisma.team.findMany({ orderBy: { createdAt: "asc" } })).map((t) => ({
          slug: t.slug,
          name: t.name,
        }))
      : teams.filter((t) => t.role === "owner").map((t) => ({ slug: t.slug, name: t.name }));

  return (
    <main className="flex min-h-screen items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-lg border border-border-token bg-bg-elevated p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-fg">팀 선택</h1>
          <p className="text-[13px] text-fg-muted">
            {teams.length > 0
              ? "들어갈 팀을 고르거나, 새 팀을 만들어 시작하세요."
              : "새 팀을 만들어 시작하거나, 받은 초대 링크로 합류하세요."}
          </p>
        </div>

        {teams.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              내 팀
            </h2>
            <TeamPicker teams={teams} />
          </section>
        )}

        <section className="flex flex-col gap-3 border-t border-border-token pt-5">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            새 팀 만들기
          </h2>
          <CreateTeamForm canCreate={canCreate} />
        </section>

        <div className="border-t border-border-token pt-4 text-[13px] text-fg-subtle">
          초대 링크를 받았다면 그 주소로 들어가면 합류할 수 있어요.
        </div>

        <DeleteTeamSection teams={deletableTeams} />
      </div>
    </main>
  );
}
