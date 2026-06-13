import { Topbar } from "@/components/shell";
import { EmptyState } from "@/components/ui";

// 자리표시 — 아이디어 화면은 이후 step에서 채운다.
export default function IdeasPage() {
  return (
    <>
      <Topbar crumbs={[{ label: "아이디어" }]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          title="아이디어는 곧 준비돼요"
          description="다음 단계에서 채워집니다."
        />
      </div>
    </>
  );
}
