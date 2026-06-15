import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import { LiveRoom } from "@/components/live";
import { getSession } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { getActiveSession } from "@/lib/live";
import { listTeamMembers } from "@/lib/teams";

// 세미나 라이브 — RSC. 현재 세션·멤버를 서버에서 직접 조회해 룸(인터랙티브 섬)에 주입(ADR-015).
// CRITICAL: live는 여기 보관하지 않는다 — 앱 레벨 LiveProvider가 단일 소스(ADR-001/R5).
// 로딩은 loading.tsx 스켈레톤, 에러는 인라인 카드(상태 3종, R26).

export default async function MeetingPage() {
  let content: React.ReactNode;
  try {
    const session = await getSession();
    if (!session) throw new Error("no session"); // 레이아웃이 보장하지만 방어적으로

    // 활성 팀으로 스코핑(R37/ADR-020) — 룸은 팀 스코프. 팀이 없으면 라이브도 없다.
    const team = await getActiveTeam(session.memberId);
    const [active, teamMembers] = await Promise.all([
      team ? getActiveSession(team.id) : Promise.resolve(null),
      team ? listTeamMembers(team.id) : Promise.resolve([]),
    ]);
    // 라이브 룸 참가자 표시는 활성 팀 멤버만(ADR-020/R37) — 다른 팀 멤버 이름을 클라로 보내지 않는다.
    const members = teamMembers.map((m) => ({
      id: m.id,
      name: m.name,
      initial: m.initial,
      color: m.color,
    }));

    content = (
      <LiveRoom
        currentMemberId={session.memberId}
        initialSession={
          active
            ? {
                id: active.id,
                presenterId: active.presenterId,
                startedAt: active.startedAt.toISOString(),
                participantIds: active.participants
                  .filter((p) => !p.leftAt)
                  .map((p) => p.memberId),
              }
            : null
        }
        members={members}
      />
    );
  } catch {
    content = (
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-[15px] font-semibold text-fg">
          라이브를 불러오지 못했어요.
        </p>
        <p className="max-w-sm text-[13px] text-fg-muted">
          잠깐 후 다시 시도해주세요.
        </p>
        <a
          href="/meeting"
          className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
        >
          다시 시도
        </a>
      </Card>
    );
  }

  return (
    <>
      <Topbar crumbs={[{ label: "세미나 라이브" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">{content}</div>
      </div>
    </>
  );
}
