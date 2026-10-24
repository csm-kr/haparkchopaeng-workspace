"use client";

import * as React from "react";
import { useLocalAgent } from "./provider";
import { chatSelection } from "./chat-selection";
import { phaseLabel, providerName, quotaWindows } from "./presentation";
import { QuotaBadge } from "./quota-badge";

export function ConnectionSettings({ collapsed = false }: { collapsed?: boolean }) {
  const agent = useLocalAgent();
  const id = React.useId();
  if (!agent) return null;
  const connected = agent.phase === "connected";
  const status = connected ? "연결됨" : phaseLabel[agent.phase];
  const target = agent.chatTarget ?? agent.selectedModel;
  const selection = connected ? chatSelection(agent.device, target, agent.effort) : null;
  const provider = connected ? agent.device?.providers.find(item => item.provider === (selection?.provider ?? target?.provider)) : null;
  const model = selection && provider?.models.find(item => item.id === selection.model);
  const modelLabel = model?.name ?? (connected ? "모델 선택 필요" : status);
  const description = model && provider ? `${providerName[provider.provider]} · ${model.name}` : modelLabel;
  return <>
    <div role="group" aria-label="AI 연결 상태" className="flex min-w-0 items-center">
      <button type="button" aria-label="AI 연결" aria-describedby={`${id}-status`} aria-haspopup="dialog"
        title={`AI 연결 · ${status} · ${description}`} onClick={agent.open} className={`flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ${collapsed ? "justify-center" : "px-2.5 py-2"}`}>
        <span className="grid size-4 shrink-0 place-items-center"><span aria-hidden="true" data-connection-state={agent.phase} className={`size-2 rounded-full ${connected ? "bg-online" : "bg-fg-faint"}`} /></span>
        {!collapsed && <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"><span className="text-[13px] font-medium">AI 연결</span><span className="w-full truncate text-[11px] text-fg-subtle">{model ? description : modelLabel}</span></span>}
      </button>
      {!collapsed && connected && provider && <QuotaBadge key={provider.provider} windows={quotaWindows(provider)} compact label="현재 모델 사용량 상세" />}
    </div>
    <span id={`${id}-status`} className="sr-only">{status} · {description}</span>
  </>;
}
