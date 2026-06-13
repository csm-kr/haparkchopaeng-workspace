import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import { TeamManager } from "@/components/team";
import { getSession } from "@/lib/auth";
import { getTeam } from "@/lib/team";
import { changeMemberRole, removeMember } from "./actions";

// 팀 관리 — RSC. 읽기는 서버에서 Prisma 직접(ADR-015/R32). 쓰기는 actions.ts(역할/내보내기)
// 및 step4의 초대 route handler(team-manager의 fetch).
// CRITICAL: 관리 액션은 서버에서 관리자 전용으로 강제(👑, R19). UI의 isAdmin 게이팅은 보조.

export default async function TeamPage() {
  const session = await getSession();
  // 인증은 (app)/layout이 보장 — 여기선 본인 식별·관리자 여부만.
  const currentUserId = session?.memberId ?? "";
  const isAdmin = session?.role === "관리자";

  let body: React.ReactNode;
  try {
    const { members, invites } = await getTeam();
    body = (
      <TeamManager
        members={members}
        invites={invites}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        onChangeRole={changeMemberRole}
        onRemoveMember={removeMember}
      />
    );
  } catch {
    // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
    body = (
      <div className="p-6">
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-[15px] font-semibold text-fg">
            팀 정보를 불러오지 못했어요.
          </p>
          <p className="max-w-sm text-[13px] text-fg-muted">
            잠깐 후 다시 시도해주세요.
          </p>
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

  return (
    <>
      <Topbar crumbs={[{ label: "팀 관리" }]} />
      <div className="flex-1 overflow-y-auto">{body}</div>
    </>
  );
}
