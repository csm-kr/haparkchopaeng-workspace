import { Topbar } from "@/components/shell";
import { Card, Skeleton } from "@/components/ui";

// 논문 목록 로딩 — 셸은 즉시 그리고 콘텐츠만 스켈레톤(R26).
// 스피너 대신 레이아웃을 유지하는 shimmer 스켈레톤.
export default function LibraryLoading() {
  return (
    <>
      <Topbar crumbs={[{ label: "논문" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-7 w-16 rounded-[10px]" />
          <Card>
            <ul className="divide-y divide-border-token">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-5 w-14 rounded-[10px]" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="size-5 shrink-0 rounded-full" />
                  <Skeleton className="h-3 w-16" />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
