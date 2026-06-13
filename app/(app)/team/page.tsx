import { Topbar } from "@/components/shell";
import { EmptyState } from "@/components/ui";

// 자리표시 — 실제 팀 관리 화면은 이후 step에서 채운다.
export default function TeamPage() {
  return (
    <>
      <Topbar crumbs={[{ label: "팀 관리" }]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          title="팀 관리는 곧 준비돼요"
          description="다음 단계에서 채워집니다."
        />
      </div>
    </>
  );
}
