import { Topbar } from "@/components/shell";
import { Card, Skeleton } from "@/components/ui";

// 논문 상세 로딩 — 셸은 즉시, 콘텐츠만 스켈레톤(R26). 레이아웃을 유지한다.
export default function Loading() {
  return (
    <>
      <Topbar crumbs={[{ label: "논문", href: "/library" }, { label: "…" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-9 w-48" />
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex flex-col gap-3 p-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
