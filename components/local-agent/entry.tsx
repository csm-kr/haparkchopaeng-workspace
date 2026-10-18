"use client";

import { Monitor } from "lucide-react";
import { useLocalAgent } from "./provider";
import { phaseLabel } from "./presentation";

/** 페이지 주 액션과 구분된 전역 셸 연결 상태. */
export function LocalAgentEntry() {
  const agent = useLocalAgent();
  if (!agent) return null;
  return <div aria-label="내 PC의 AI 연결" className="flex shrink-0 items-center border-l border-border-token pl-2">
    <button type="button" onClick={agent.open} disabled={agent.phase === "loading"}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-sm px-2 text-[12px] font-medium text-fg-muted hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:opacity-50">
      <Monitor size={14} aria-hidden="true" />
      <span className="max-w-[110px] truncate">{phaseLabel[agent.phase]}</span>
      {agent.phase === "connected" && <span className="size-1.5 shrink-0 rounded-full bg-online" aria-hidden="true" />}
    </button>
  </div>;
}
