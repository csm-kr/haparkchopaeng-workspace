"use client";

import { Monitor } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useLocalAgent } from "./provider";
import { phaseLabel } from "./presentation";

export function LocalAgentSettingsCard() {
  const agent = useLocalAgent();
  if (!agent) return null;
  return <Card role="region" className="flex flex-col gap-4 p-5" aria-labelledby="local-agent-settings-title">
    <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 flex-col gap-1"><h2 id="local-agent-settings-title" className="text-[20px] font-semibold text-fg">AI 연결</h2><p className="text-[12px] leading-relaxed text-fg-muted">내 PC의 AI와 연결, 다음 질문에 사용할 모델을 관리해요.</p></div><Monitor size={18} aria-hidden="true" className="mt-1 shrink-0 text-fg-subtle" /></div>
    <p role="status" className="text-[13px] text-fg-muted">{agent.phase === "connected" ? agent.device?.name : phaseLabel[agent.phase]}</p>
    <Button variant="secondary" onClick={agent.open}>AI 연결 관리</Button>
  </Card>;
}
