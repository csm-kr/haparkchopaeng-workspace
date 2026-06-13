"use client";

import { useLive } from "@/components/providers";

// 홈(대시보드) 상단 LIVE 배너 — live===true일 때만 보인다(ADR-001).
// live가 단일 앱 레벨 소스이므로 사이드바 알약·이 배너가 항상 일치한다.
// R29: 색 + 텍스트 병행, 깜빡임은 reduced-motion에서 정적 대체.
export function LiveBanner() {
  const { live } = useLive();
  if (!live) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border-token bg-accent px-6 py-2.5 text-[13px] font-medium text-accent-fg"
    >
      <span
        aria-hidden="true"
        className="anim-livepulse size-2 rounded-full bg-accent-fg"
      />
      지금 세미나 라이브가 진행 중이에요.
      {/* TODO(라이브 step): 라이브 룸으로 이동하는 링크 연결 */}
    </div>
  );
}
