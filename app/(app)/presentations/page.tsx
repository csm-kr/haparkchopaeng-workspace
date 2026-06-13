import { Topbar } from "@/components/shell";
import { EmptyState } from "@/components/ui";

// 자리표시 — 실제 발표 자료 목록은 이후 step에서 채운다.
export default function PresentationsPage() {
  return (
    <>
      <Topbar crumbs={[{ label: "발표 자료" }]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          title="발표 자료는 곧 준비돼요"
          description="다음 단계에서 채워집니다."
        />
      </div>
    </>
  );
}
