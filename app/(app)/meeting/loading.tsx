import { Topbar } from "@/components/shell";
import { Card, Skeleton } from "@/components/ui";

// 세미나 라이브 로딩 — 셸은 즉시, 콘텐츠만 스켈레톤(R26). 스피너 대신 레이아웃 유지.
export default function MeetingLoading() {
  return (
    <>
      <Topbar crumbs={[{ label: "세미나 라이브" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Card className="flex flex-col gap-3 p-4">
            <Skeleton className="h-3 w-20" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="size-6 shrink-0 rounded-full" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-5 w-14 rounded-[10px]" />
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
