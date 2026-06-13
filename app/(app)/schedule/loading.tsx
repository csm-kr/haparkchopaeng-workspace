import { Topbar } from "@/components/shell";
import { Card, Skeleton } from "@/components/ui";

// 스케줄 로딩 — 셸은 즉시 그리고 콘텐츠만 스켈레톤(R26). 스피너 대신 shimmer.
export default function ScheduleLoading() {
  return (
    <>
      <Topbar crumbs={[{ label: "스케쥴" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-3.5 w-64" />
          </div>
          <Card>
            <div className="flex items-center justify-between border-b border-border-token px-4 py-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-6 w-12" />
            </div>
            <ul className="divide-y divide-border-token">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-5 w-12" />
                  <Skeleton className="size-5 rounded-full" />
                  <Skeleton className="ml-auto h-6 w-20" />
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4">
            <Skeleton className="h-6 w-24" />
          </Card>
        </div>
      </div>
    </>
  );
}
