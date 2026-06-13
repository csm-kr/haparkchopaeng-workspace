import { Topbar } from "@/components/shell";
import { EmptyState } from "@/components/ui";

// 자리표시 — 실제 논문 목록은 이후 step에서 채운다.
export default function LibraryPage() {
  return (
    <>
      <Topbar crumbs={[{ label: "논문" }]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState title="논문은 곧 준비돼요" description="다음 단계에서 채워집니다." />
      </div>
    </>
  );
}
