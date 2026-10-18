"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import type { LocalAgentProvider as ProviderName } from "@/types/local-agent";
import { ConnectionDialog } from "./connection-dialog";
import { useLocalAgent } from "./provider";
import { chatSelection, EFFORT_LABELS, modelEfforts } from "./chat-selection";
import { phaseLabel, providerName, providerStatus, quotaWindows } from "./presentation";
import { QuotaBadge } from "./quota-badge";
import { BridgeUpdateInfo } from "./bridge-update";

const PROVIDERS: ProviderName[] = ["codex", "claude"];

export function ConnectionSettings({ collapsed = false }: { collapsed?: boolean }) {
  const agent = useLocalAgent();
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<{ deviceId: string | null; provider: ProviderName } | null>(null);
  const tabs = React.useRef<Partial<Record<ProviderName, HTMLButtonElement | null>>>({});
  const pendingConnection = React.useRef(false);
  const id = React.useId();
  React.useEffect(() => {
    // 기존 창이 포커스를 복원한 뒤 다음 창이 복원 대상을 저장하게 한다.
    if (!open && pendingConnection.current && agent) {
      pendingConnection.current = false;
      agent.open();
    }
  }, [open, agent]);
  if (!agent) return null;
  const connected = agent.phase === "connected";
  const status = connected ? "연결됨" : phaseLabel[agent.phase];
  const target = agent.chatTarget ?? agent.selectedModel;
  const selection = chatSelection(agent.device, agent.chatTarget ?? agent.selectedModel, agent.effort);
  const deviceId = agent.device?.id ?? null;
  const firstProvider = target?.provider ?? PROVIDERS.find(name => agent.device?.providers.some(provider => provider.provider === name && provider.status === "ready")) ?? "codex";
  const active = view?.deviceId === deviceId ? view.provider : firstProvider;
  const provider = agent.device?.providers.find(item => item.provider === active);
  const models = provider?.status === "ready" ? provider.models : [];
  const current = selection?.provider === active ? selection : null;
  const selected = models.find(model => model.id === current?.model);
  const efforts = modelEfforts(selected);
  const canSelect = connected && models.length > 0;
  const close = () => { setOpen(false); setView(null); };
  const showProvider = (name: ProviderName) => setView({ deviceId, provider: name });
  const unavailable = !provider ? "CLI 상태를 아직 확인하지 못했어요."
    : provider.status === "not_installed" ? `AI 브릿지에서 ${providerName[active]} 설치 안내를 확인해 주세요.`
    : provider.status === "login_required" ? `AI 브릿지에서 ${providerName[active]} 로그인을 확인해 주세요.`
    : provider.status === "limited" ? "사용 한도에 도달했어요. 한도를 확인한 뒤 다시 시도해 주세요."
    : provider.status === "error" ? "CLI 상태를 확인하지 못했어요. AI 브릿지에서 다시 확인해 주세요."
    : models.length === 0 ? "이 도구가 제공한 모델이 아직 없어요." : null;
  return <>
    <button type="button" aria-label="AI 연결" aria-describedby={`${id}-status`} aria-haspopup="dialog" aria-expanded={open}
      title={`AI 연결 · ${status}`} onClick={() => setOpen(true)} className={`flex min-h-11 w-full items-center gap-2 rounded-sm text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ${collapsed ? "justify-center" : "px-2.5"}`}>
      <span aria-hidden="true" data-connection-state={agent.phase} className={`size-2 shrink-0 rounded-full ${connected ? "bg-online" : "bg-fg-faint"}`} />
      {!collapsed && <span>AI 연결</span>}
    </button>
    <span id={`${id}-status`} className="sr-only">{status}</span>
    {open && <ConnectionDialog title="AI 연결" onClose={close}>
      <div className="flex items-center justify-between gap-3 rounded-md bg-bg-subtle p-3">
        <div className="min-w-0"><p className="truncate text-[13px] font-medium text-fg">{agent.device?.name ?? "내 AI 연결"}</p><p className="mt-1 text-[12px] text-fg-muted">{status}</p></div>
        <Button variant="secondary" size="sm" onClick={() => { pendingConnection.current = true; close(); }}>{connected ? "연결 관리" : "연결하기"}</Button>
      </div>
      <div role="tablist" aria-label="AI 도구" className="flex gap-1 rounded-md bg-bg-subtle p-1">
        {PROVIDERS.map(name => <button key={name} ref={node => { tabs.current[name] = node; }} type="button" role="tab"
          id={`${id}-tab-${name}`} aria-selected={active === name} aria-controls={`${id}-panel`} tabIndex={active === name ? 0 : -1}
          onClick={() => showProvider(name)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const index = event.key === "Home" ? 0 : event.key === "End" ? PROVIDERS.length - 1
              : (PROVIDERS.indexOf(name) + (event.key === "ArrowRight" ? 1 : -1) + PROVIDERS.length) % PROVIDERS.length;
            showProvider(PROVIDERS[index]); tabs.current[PROVIDERS[index]]?.focus();
          }} className={`min-h-11 flex-1 rounded-sm px-3 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ${active === name ? "bg-bg-elevated text-fg shadow-[var(--shadow-xs)]" : "text-fg-muted hover:text-fg"}`}>
          {providerName[name]}
        </button>)}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${active}`} className="flex flex-col gap-3">
        <div className="flex min-h-10 items-center justify-between gap-3">
          <p role="status" className="text-[12px] text-fg-muted">{provider ? providerStatus[provider.status] : "상태 확인 전"}</p>
          {connected && provider && <QuotaBadge windows={quotaWindows(provider)} />}
        </div>
        {unavailable && <p className="text-[12px] leading-relaxed text-fg-muted">{unavailable}</p>}
        <label className="flex flex-col gap-2 text-[12px] font-medium text-fg-muted">모델
          <select aria-label="모델" value={current ? `${active}:${current.model}` : ""} disabled={!canSelect} onChange={event => {
            const model = models.find(item => `${active}:${item.id}` === event.target.value);
            if (model) agent.selectModel({ provider: active, model: model.id });
          }} className="min-h-11 w-full rounded-sm border border-border-strong bg-bg-elevated px-3 text-[13px] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft disabled:opacity-50">
            {!current && <option value="">{!connected ? "연결 후 선택할 수 있어요" : models.length ? "모델을 선택해 주세요" : "사용 가능한 모델이 없어요"}</option>}
            {models.map(model => <option key={model.id} value={`${active}:${model.id}`}>{model.name}</option>)}
          </select>
        </label>
        {connected && agent.chatTarget && !selection && <p className="text-[12px] leading-relaxed text-busy">사용하던 모델을 사용할 수 없어요. 새 모델을 직접 선택해 주세요.</p>}
        {efforts.length > 0 ? <fieldset disabled={!current || !connected} className="flex flex-col gap-2 disabled:opacity-50">
          <legend className="mb-2 text-[12px] font-medium text-fg-muted">Effort</legend>
          <div className="flex flex-wrap gap-1 rounded-md bg-bg-subtle p-1">{efforts.map(value => <label key={value} className={`relative flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-sm px-2 text-[12px] ${current?.effort === value ? "bg-bg-elevated text-fg shadow-[var(--shadow-xs)]" : "text-fg-muted hover:text-fg"}`}>
            <input type="radio" name="ai-effort" value={value} checked={current?.effort === value} onChange={() => agent.setEffort(value)} className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            <span className="pointer-events-none whitespace-nowrap rounded-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">{EFFORT_LABELS[value]}</span>
          </label>)}</div>
        </fieldset> : <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-fg-muted">Effort</span>
          <Button variant="secondary" disabled aria-describedby={`${id}-effort`}>지원 정보 없음</Button>
          <p id={`${id}-effort`} className="text-[12px] leading-relaxed text-fg-muted">{current ? "effort 지원 정보를 확인할 수 없어요. AI 브릿지 업데이트와 해당 모델의 지원 여부를 확인해 주세요." : "모델을 선택하면 지원하는 effort를 확인할 수 있어요."}</p>
        </div>}
        <p className="text-[11px] text-fg-subtle">모델과 effort를 선택하면 다음 메시지부터 적용돼요.</p>
      </div>
      <BridgeUpdateInfo />
      <Button onClick={close}>완료</Button>
    </ConnectionDialog>}
  </>;
}
