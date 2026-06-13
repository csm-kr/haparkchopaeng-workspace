import { Topbar } from "@/components/shell";
import { EmptyState } from "@/components/ui";

// 자리표시 — 실제 라이브(빈 상태 + 룸)는 이후 라이브 step에서 채운다.
// live 상태/룸은 여기 보관하지 않는다(ADR-001/R5) — 앱 레벨 LiveProvider가 단일 소스.
export default function MeetingPage() {
  return (
    <>
      <Topbar crumbs={[{ label: "세미나 라이브" }]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          title="세미나 라이브는 곧 준비돼요"
          description="다음 단계에서 채워집니다."
        />
      </div>
    </>
  );
}
