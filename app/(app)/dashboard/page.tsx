import { Topbar, LiveBanner } from "@/components/shell";
import { EmptyState } from "@/components/ui";

// 자리표시 — 실제 홈은 이후 step(dashboard)에서 채운다.
export default function DashboardPage() {
  return (
    <>
      <Topbar crumbs={[{ label: "홈" }]} />
      <LiveBanner />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          title="홈은 곧 준비돼요"
          description="다음 단계에서 채워집니다."
        />
      </div>
    </>
  );
}
