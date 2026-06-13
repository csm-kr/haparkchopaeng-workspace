import { Topbar } from "@/components/shell";
import { Card, Skeleton } from "@/components/ui";

// 발표 자료 상세 로딩 — 셸은 즉시 그리고 콘텐츠만 스켈레톤(R26).
export default function PresentationDetailLoading() {
  return (
    <>
      <Topbar
        crumbs={[{ label: "발표 자료", href: "/presentations" }, { label: "불러오는 중" }]}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Card className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-3/5" />
          </Card>
        </div>
      </div>
    </>
  );
}
