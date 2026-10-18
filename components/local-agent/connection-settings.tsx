"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui";
import { ChatDialog } from "@/components/research-chat/dialog";
import { useLocalAgent } from "./provider";
import { chatSelection, EFFORT_LABELS, modelEfforts } from "./chat-selection";
import { providerName } from "./presentation";

export function ConnectionSettings({ collapsed = false }: { collapsed?: boolean }) {
  const agent = useLocalAgent();
  const [open, setOpen] = React.useState(false);
  if (!agent) return null;
  const selection = chatSelection(agent.device, agent.chatTarget ?? agent.selectedModel, agent.effort);
  const models = agent.device?.providers.flatMap(provider => provider.status === "ready" ? provider.models.map(model => ({ provider: provider.provider, model })) : []) ?? [];
  const selected = models.find(item => item.provider === selection?.provider && item.model.id === selection.model);
  const efforts = modelEfforts(selected?.model);
  return <>
    <button type="button" aria-label="연결 설정" title="연결 설정" onClick={() => setOpen(true)} className={`flex min-h-11 w-full items-center gap-2 rounded-sm text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ${collapsed ? "justify-center" : "px-2.5"}`}>
      <SlidersHorizontal size={16} aria-hidden="true" />{!collapsed && <span>연결 설정</span>}
    </button>
    {open && <ChatDialog title="연결 설정" onClose={() => setOpen(false)}>
      <div className="flex items-center justify-between gap-3 rounded-md bg-bg-subtle p-3">
        <div className="min-w-0"><p className="truncate text-[13px] font-medium text-fg">{agent.device?.name ?? "내 AI 연결"}</p><p className="mt-1 text-[12px] text-fg-muted">{agent.phase === "connected" ? "연결됨" : agent.phase === "loading" ? "연결 확인 중…" : "연결이 필요해요"}</p></div>
        <Button variant="secondary" size="sm" onClick={() => { setOpen(false); agent.open(); }}>{agent.phase === "connected" ? "연결 관리" : "AI 연결"}</Button>
      </div>
      <label className="flex flex-col gap-2 text-[12px] font-medium text-fg-muted">모델
        <select aria-label="모델" value={selection ? `${selection.provider}:${selection.model}` : ""} disabled={!models.length || agent.phase !== "connected"} onChange={event => {
          const option = models.find(item => `${item.provider}:${item.model.id}` === event.target.value);
          if (option) agent.selectModel({ provider: option.provider, model: option.model.id });
        }} className="min-h-11 w-full rounded-sm border border-border-strong bg-bg-elevated px-3 text-[13px] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft disabled:opacity-50">
          {!selection && <option value="">{agent.phase !== "connected" ? "연결 후 선택할 수 있어요" : models.length ? "사용할 모델을 다시 선택해 주세요" : "사용 가능한 모델이 없어요"}</option>}
          {models.map(item => <option key={`${item.provider}:${item.model.id}`} value={`${item.provider}:${item.model.id}`}>{providerName[item.provider]} · {item.model.name}</option>)}
        </select>
      </label>
      {agent.phase === "connected" && agent.chatTarget && !selection && <p className="text-[12px] leading-relaxed text-busy">사용하던 모델을 사용할 수 없어요. 새 모델을 직접 선택해 주세요.</p>}
      {efforts.length > 0 ? <fieldset disabled={!selection || agent.phase !== "connected"} className="flex flex-col gap-2 disabled:opacity-50">
        <legend className="mb-2 text-[12px] font-medium text-fg-muted">Effort</legend>
        <div className="flex flex-wrap gap-1 rounded-md bg-bg-subtle p-1">{efforts.map(value => <label key={value} className={`relative flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-sm px-2 text-[12px] ${selection?.effort === value ? "bg-bg-elevated text-fg shadow-[var(--shadow-xs)]" : "text-fg-muted hover:text-fg"}`}>
          <input type="radio" name="ai-effort" value={value} checked={selection?.effort === value} onChange={() => agent.setEffort(value)} className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          <span className="pointer-events-none whitespace-nowrap rounded-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">{EFFORT_LABELS[value]}</span>
        </label>)}</div>
      </fieldset> : selection && <p className="text-[12px] leading-relaxed text-fg-muted">effort 지원 정보를 확인할 수 없어요. AI 브릿지 업데이트와 해당 모델의 지원 여부를 확인해 주세요.</p>}
      {efforts.length > 0 && <p className="text-[11px] text-fg-subtle">변경한 설정은 다음 메시지부터 적용돼요.</p>}
    </ChatDialog>}
  </>;
}
