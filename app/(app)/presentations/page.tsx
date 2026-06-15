import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import { CreatePresentationButton, PresentationList } from "@/components/presentations";
import { getPresentations } from "@/lib/presentations";
import { getSession } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";

// 발표 자료 목록 — RSC. 읽기는 서버에서 Prisma 직접 조회(ADR-015/R32).
// 로딩은 loading.tsx(스켈레톤), 빈 상태는 PresentationList 내부에서 처리한다(R26).
// CRITICAL: 활성 팀으로 스코핑(R37/ADR-020). 팀 없음은 layout이 처리 — 방어적으로 리다이렉트.

export default async function PresentationsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const team = await getActiveTeam(session.memberId);
  if (!team) redirect("/teams/new");

  let content: React.ReactNode;
  try {
    const presentations = await getPresentations(team.id);
    content = <PresentationList presentations={presentations} />;
  } catch {
    // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
    content = (
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-[15px] font-semibold text-fg">
          발표 자료를 불러오지 못했어요.
        </p>
        <p className="max-w-sm text-[13px] text-fg-muted">
          잠깐 후 다시 시도해주세요.
        </p>
        <Link
          href="/presentations"
          className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
        >
          다시 시도
        </Link>
      </Card>
    );
  }

  return (
    <>
      <Topbar
        crumbs={[{ label: "발표 자료" }]}
        actions={<CreatePresentationButton />}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">{content}</div>
      </div>
    </>
  );
}
