import { Topbar } from "@/components/shell";
import { EmptyState } from "@/components/ui";

// 자리표시 — 실제 설정(프로필·알림·테마·법적 링크)은 이후 step에서 채운다.
export default function ProfilePage() {
  return (
    <>
      <Topbar crumbs={[{ label: "설정" }]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState title="설정은 곧 준비돼요" description="다음 단계에서 채워집니다." />
      </div>
    </>
  );
}
