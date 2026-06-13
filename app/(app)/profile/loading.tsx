import { Topbar } from "@/components/shell";
import { Card, Skeleton } from "@/components/ui";

// 설정 로딩 — 셸은 즉시 그리고 콘텐츠만 스켈레톤(R26). 스피너 대신 shimmer.
export default function ProfileLoading() {
  return (
    <>
      <Topbar crumbs={[{ label: "설정" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3.5 w-56" />
          </div>
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex flex-col gap-4 p-5">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
