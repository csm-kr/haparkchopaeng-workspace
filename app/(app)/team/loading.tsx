import { Topbar } from "@/components/shell";
import { Card, Skeleton } from "@/components/ui";

// 팀 관리 로딩 — 셸은 즉시 그리고 콘텐츠만 스켈레톤(R26). 스피너 대신 shimmer.
export default function TeamLoading() {
  return (
    <>
      <Topbar crumbs={[{ label: "팀 관리" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3.5 w-64" />
          </div>
          <Card className="p-4">
            <Skeleton className="h-9 w-full" />
          </Card>
          <Card>
            <div className="border-b border-border-token px-4 py-3">
              <Skeleton className="h-6 w-24" />
            </div>
            <ul className="divide-y divide-border-token">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <Skeleton className="h-5 w-12 rounded-[10px]" />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
