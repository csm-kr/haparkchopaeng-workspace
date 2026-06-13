import { Topbar } from "@/components/shell";
import { EmptyState } from "@/components/ui";

// 자리표시 — 실제 스케줄 보드는 이후 step에서 채운다.
export default function SchedulePage() {
  return (
    <>
      <Topbar crumbs={[{ label: "스케쥴" }]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          title="스케쥴은 곧 준비돼요"
          description="다음 단계에서 채워집니다."
        />
      </div>
    </>
  );
}
