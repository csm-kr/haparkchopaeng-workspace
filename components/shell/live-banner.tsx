"use client";

import Link from "next/link";
import { useLive } from "@/components/providers";

// 홈(대시보드) 상단 LIVE 배너 — live===true일 때만 보인다(ADR-001).
// live가 단일 앱 레벨 소스이므로 사이드바 알약·이 배너가 항상 일치한다.
// 클릭하면 라이브 룸(/meeting)으로 — 입장 최단 경로(≤2클릭, USER_FLOW F1).
// R29: 색 + 텍스트 병행, 깜빡임은 reduced-motion에서 정적 대체.
export function LiveBanner() {
  const { live } = useLive();
  if (!live) return null;

  return (
    <Link
      href="/meeting"
      role="status"
      className="flex items-center gap-2 border-b border-border-token bg-accent px-6 py-2.5 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
    >
      <span
        aria-hidden="true"
        className="anim-livepulse size-2 rounded-full bg-accent-fg"
      />
      지금 모두의 세미나가 진행 중이에요. 입장하기 →
    </Link>
  );
}
