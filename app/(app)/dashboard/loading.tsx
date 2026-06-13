import { Topbar } from "@/components/shell";
import { Card, Skeleton } from "@/components/ui";

// 홈 로딩 — RSC 데이터 대기 동안 셸은 즉시 그리고 콘텐츠만 스켈레톤(R26).
// 스피너 대신 레이아웃을 유지하는 shimmer 스켈레톤.
export default function DashboardLoading() {
  return (
    <>
      <Topbar crumbs={[{ label: "홈" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <Card key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="size-10 shrink-0 rounded-md" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-5 w-12" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <Card key={i} className="flex flex-col gap-3 p-4">
                {[0, 1, 2].map((j) => (
                  <Skeleton key={j} className="h-8 w-full" />
                ))}
              </Card>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
