import { cn } from "@/lib/utils";
import type { QuotaStatus } from "@/lib/rate-limit";

// 상시 노출 쿼터 뱃지 — 라이브러리 상단바에 "이번 주 분석 X/20"을 항상 보여준다(모달 안에만 있던 정보를 표면화).
// 매주 월요일 0시(KST) 리셋(lib/rate-limit.startOfWeekKST). 표시 전용이라 RSC로 둔다.
// 무제한(limit≤0, 개발·테스트)이면 렌더하지 않는다 — 표시할 한도가 없음.

export function QuotaBadge({ quota }: { quota?: QuotaStatus }) {
  if (!quota || quota.limit <= 0) return null;
  const exhausted = quota.remaining === 0;
  return (
    <span
      title="이번 주 분석 한도 · 매주 월요일 0시(KST)에 리셋돼요"
      className={cn(
        "inline-flex items-center gap-1 rounded-[10px] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        "bg-bg-subtle",
        exhausted ? "text-busy" : "text-fg-muted",
      )}
    >
      이번 주 분석{" "}
      <span className={cn("font-mono", exhausted ? "text-busy" : "text-fg")}>
        {quota.used}/{quota.limit}
      </span>
      {exhausted && <span className="text-busy"> · 다음 주 리셋</span>}
    </span>
  );
}
