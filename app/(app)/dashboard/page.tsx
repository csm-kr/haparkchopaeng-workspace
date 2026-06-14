import { Topbar, LiveBanner } from "@/components/shell";
import { Card } from "@/components/ui";
import { QuickCards, RecentActivity } from "@/components/dashboard";
import { getDashboardData } from "@/lib/dashboard";

// 홈(대시보드) — RSC. 읽기는 서버에서 Prisma 직접 조회(ADR-015/R32).
// LIVE 배너는 인터랙티브 섬(useLive)이고, 데이터 카드/목록은 RSC다.
// 로딩 상태는 같은 폴더의 loading.tsx(스켈레톤)가 담당한다(R26).

export default async function DashboardPage() {
  let content: React.ReactNode;
  try {
    const data = await getDashboardData();
    content = (
      <div className="flex flex-col gap-6 p-6">
        <QuickCards
          paperCount={data.paperCount}
          presentationCount={data.presentationCount}
        />
        <RecentActivity
          recentPapers={data.recentPapers}
          recentPresentations={data.recentPresentations}
        />
      </div>
    );
  } catch {
    // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
    content = (
      <div className="p-6">
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-[15px] font-semibold text-fg">
            홈을 불러오지 못했어요.
          </p>
          <p className="max-w-sm text-[13px] text-fg-muted">
            잠깐 후 다시 시도해주세요.
          </p>
          {/* 다시 시도 = 새로고침. 새 라우트로의 변이가 없으므로 링크로 둔다. */}
          <a
            href="/dashboard"
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
      <Topbar crumbs={[{ label: "홈" }]} />
      {/* live===true일 때만 렌더(ADR-001/R5). live는 화면에 보관하지 않는다. */}
      <LiveBanner />
      <div className="flex-1 overflow-y-auto">{content}</div>
    </>
  );
}
