import { Topbar } from "@/components/shell";
import { Card, Skeleton } from "@/components/ui";

// NEWS 목록 로딩 — 셸은 즉시 그리고 콘텐츠(카드 그리드)만 스켈레톤(R26).
export default function NewsLoading() {
  return (
    <>
      <Topbar crumbs={[{ label: "NEWS" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="flex flex-col">
                <Skeleton className="aspect-[16/9] w-full rounded-none" />
                <div className="flex flex-col gap-2 px-4 py-3">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
