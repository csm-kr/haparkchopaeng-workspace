"use client";

import * as React from "react";
import type { LocalAgentProvider as ProviderName } from "@/types/local-agent";
import { chatSelection, EFFORT_LABELS, modelEfforts } from "./chat-selection";
import { providerName, providerStatus, quotaWindows } from "./presentation";
import { QuotaBadge } from "./quota-badge";
import { BridgeUpdateInfo } from "./bridge-update";
import { Check, Monitor } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { ConnectionDialog } from "./connection-dialog";
import { useLocalAgent } from "./provider";
import { InstallHelp } from "./install-help";

export function ConnectionModal({ onClose }: { onClose: () => void }) {
  const agent = useLocalAgent();
  const [section, setSection] = React.useState<"overview" | "install">("overview");
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const codeHeading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    if (agent?.phase === "awaiting_code") codeHeading.current?.focus();
  }, [agent?.phase]);
  if (!agent) return null;
  const pending = ["creating", "opening", "awaiting_code"].includes(agent.phase);
  const code = agent.attempt?.code;
  const secondsLeft = agent.pairingSecondsLeft;
  const countdown = secondsLeft === null ? null
    : `${Math.floor(secondsLeft / 60).toString().padStart(2, "0")}:${(secondsLeft % 60).toString().padStart(2, "0")}`;
  return <ConnectionDialog title="AI 연결" onClose={onClose}>
    {agent.phase === "connected" && agent.device ? <>
      <div className="flex items-center gap-3 rounded-md bg-bg-subtle p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent"><Monitor size={18} aria-hidden="true" /></span>
        <div className="flex min-w-0 flex-col gap-0.5"><span className="truncate text-[14px] font-semibold text-fg">{agent.device.name}</span><span role="status" className="inline-flex items-center gap-1 text-[12px] text-fg-muted"><Check size={12} aria-hidden="true" />이 웹에 연결됐어요</span></div>
      </div>
      <ConnectedControls />
      <BridgeUpdateInfo onReconnect={() => void agent.start()} />
      <div className="flex flex-wrap items-center gap-2 border-t border-border-token pt-3">
        <Button size="sm" variant="ghost" onClick={() => void agent.refresh()}>상태 다시 확인</Button>
        {confirmDisconnect ? <><span className="text-[12px] text-fg-muted">이 PC의 실행 권한을 해제할까요?</span><Button size="sm" variant="danger" onClick={() => { setConfirmDisconnect(false); void agent.disconnect(); }}>연결 해제</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)}>취소</Button></> : <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)}>이 PC 연결 해제</Button>}
      </div>
      <Button onClick={onClose}>완료</Button>
    </> : <>
      <div className="flex flex-col gap-2" aria-live="polite">
        <h3 ref={codeHeading} tabIndex={-1} className="text-[16px] font-semibold text-fg">{agent.phase === "creating" ? "연결을 준비하고 있어요" : agent.phase === "awaiting_code" ? "웹의 번호를 AI 브릿지에 입력해 주세요" : agent.phase === "opening" ? "AI 브릿지를 열고 있어요" : agent.phase === "expired" ? "연결 번호가 만료됐어요" : agent.phase === "cancelled" ? "연결을 취소했어요" : agent.phase === "login_required" ? "다시 로그인해 주세요" : agent.phase === "offline" ? "AI 브릿지를 다시 열어 주세요" : "내 PC의 AI를 연결해요"}</h3>
        <p className="text-[13px] leading-relaxed text-fg-muted">{agent.phase === "awaiting_code" ? "AI 브릿지가 응답했어요. 아래 번호를 앱에 입력해 연결을 확인해 주세요." : pending ? "브라우저의 앱 열기 요청을 허용해 주세요. 처음이라면 AI 브릿지를 한 번 설치해 주세요. 앱이 응답하면 확인 번호가 나타나요. 이전에 승인한 기기라면 바로 이어져요." : agent.phase === "expired" ? "새 번호로 다시 연결하면 돼요. 설치 파일은 다시 받을 필요 없어요." : agent.phase === "login_required" ? "로그인한 뒤 웹의 새 번호를 AI 브릿지에 입력해 주세요. AI 브릿지를 다시 설치하지 않아도 돼요." : "기존 Codex·Claude Code를 사용해 논문을 읽고 질문할 수 있어요. AI 브릿지는 처음에 한 번 설치해요."}</p>
      </div>
      {agent.phase === "awaiting_code" && code && secondsLeft !== null && secondsLeft > 0 && <div className="flex flex-col gap-2 rounded-md border border-border-token bg-bg-subtle p-4">
        <span className="text-[12px] font-medium text-fg-muted">웹의 번호를 AI 브릿지에 입력</span>
        <output aria-label="연결 확인 번호" className="font-mono text-[30px] font-semibold tracking-[0.15em] text-fg">{code.slice(0, 3)} {code.slice(3)}</output>
        <div className="flex items-center justify-between gap-3 text-[12px]">
          <span className="text-fg-muted">5분 안에 입력해 주세요</span>
          <span role="timer" aria-label="연결 번호 남은 시간" aria-live="off"
            className={`font-mono tabular-nums ${secondsLeft <= 60 ? "text-busy" : "text-fg"}`}>{countdown} 남음</span>
        </div>
        <div role="progressbar" aria-label="연결 가능 시간" aria-valuemin={0} aria-valuemax={300}
          aria-valuenow={secondsLeft} aria-valuetext={`${countdown} 남음`}
          className="h-1 w-full overflow-hidden rounded-full bg-bg-hover">
          <div className={`h-full ${secondsLeft <= 60 ? "bg-busy" : "bg-accent"}`} style={{ width: `${secondsLeft / 3}%` }} />
        </div>
        <span className="text-[11px] text-fg-muted">계정과 팀을 AI 브릿지에서 확인해 주세요.</span>
      </div>}
      {pending && agent.phase !== "awaiting_code" && !agent.fallback && <>
        <div className="h-1 w-full overflow-hidden rounded-full bg-bg-subtle" aria-hidden="true"><div className="h-full w-1/3 bg-accent-soft" /></div>
        <button type="button" onClick={agent.showFallback} className="self-start rounded-sm py-1 text-[12px] text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft">AI 브릿지가 열리지 않아요</button>
      </>}
      {(section === "install" || agent.fallback) && agent.phase !== "login_required" && agent.phase !== "awaiting_code" && (!pending || agent.fallback) && <InstallHelp onBack={() => setSection("overview")} />}
      {!pending && agent.phase !== "login_required" && section !== "install" && !agent.fallback && <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-md border border-border-token p-3"><span className="text-[12px] text-fg-muted">처음 사용</span><Button variant="secondary" onClick={() => setSection("install")}>설치 파일 받기</Button></div>
        <div className="flex flex-col gap-2 rounded-md border border-border-token p-3"><span className="text-[12px] text-fg-muted">이미 설치함</span><Button disabled={agent.phase === "loading"} onClick={() => void agent.start()}>{agent.phase === "expired" ? "새 번호로 연결" : "AI 브릿지 열기"}</Button></div>
      </div>}
      {agent.phase === "login_required" && <Link href="/" className="inline-flex min-h-10 items-center justify-center rounded-sm bg-accent px-3 text-[13px] font-medium text-accent-fg">로그인하러 가기</Link>}
      {pending && <Button variant="ghost" onClick={() => void agent.cancel()}>연결 취소</Button>}
    </>}
    {agent.message && <p role="alert" className="text-[12px] leading-relaxed text-busy">{agent.message}</p>}
  </ConnectionDialog>;
}

const PROVIDERS: ProviderName[] = ["codex", "claude"];

function ConnectedControls() {
  const agent = useLocalAgent();
  const [view, setView] = React.useState<{ deviceId: string | null; provider: ProviderName } | null>(null);
  const tabs = React.useRef<Partial<Record<ProviderName, HTMLButtonElement | null>>>({});
  const id = React.useId();
  if (!agent) return null;
  const connected = agent.phase === "connected";
  const target = agent.chatTarget ?? agent.selectedModel;
  const selection = chatSelection(agent.device, target, agent.effort);
  const deviceId = agent.device?.id ?? null;
  const firstProvider = target?.provider ?? PROVIDERS.find(name => agent.device?.providers.some(provider => provider.provider === name && provider.status === "ready")) ?? "codex";
  const active = view?.deviceId === deviceId ? view.provider : firstProvider;
  const provider = agent.device?.providers.find(item => item.provider === active);
  const models = provider?.status === "ready" ? provider.models : [];
  const current = selection?.provider === active ? selection : null;
  const selected = models.find(model => model.id === current?.model);
  const efforts = modelEfforts(selected);
  const canSelect = connected && models.length > 0;
  const showProvider = (name: ProviderName) => setView({ deviceId, provider: name });
  const unavailable = !provider ? null
    : provider.status === "not_installed" ? `AI 브릿지에서 ${providerName[active]} 설치 안내를 확인해 주세요.`
    : provider.status === "login_required" ? `AI 브릿지에서 ${providerName[active]} 로그인을 확인해 주세요.`
    : provider.status === "limited" ? "사용 한도에 도달했어요. 한도를 확인한 뒤 다시 시도해 주세요."
    : provider.status === "error" ? "CLI 상태를 확인하지 못했어요. AI 브릿지에서 다시 확인해 주세요."
    : models.length === 0 ? "이 도구가 제공한 모델이 아직 없어요." : null;
  const targetSnapshot = agent.device?.providers.find(item => item.provider === selection?.provider);
  const targetModel = targetSnapshot?.models.find(item => item.id === selection?.model);
  return <>
    <p className="break-words text-[12px] text-fg-muted">다음 질문 · {selection && targetModel ? `${providerName[selection.provider]} · ${targetModel.name}` : "모델 선택 필요"}</p>
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
        {provider && <div className="flex min-h-10 items-center justify-between gap-3">
          <p role="status" className="text-[12px] text-fg-muted">{providerStatus[provider.status]}</p>
          <QuotaBadge windows={quotaWindows(provider)} />
        </div>}
        {unavailable && <p className="text-[12px] leading-relaxed text-fg-muted">{unavailable}</p>}
        <label className="flex flex-col gap-2 text-[12px] font-medium text-fg-muted">모델
          <select aria-label="모델" value={current ? `${active}:${current.model}` : ""} disabled={!canSelect} onChange={event => {
            const model = models.find(item => `${active}:${item.id}` === event.target.value);
            if (model) agent.selectModel({ provider: active, model: model.id });
          }} className="min-h-11 w-full rounded-sm border border-border-strong bg-bg-elevated px-3 text-[13px] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft disabled:opacity-50">
            {!current && <option value="">{models.length ? "모델을 선택해 주세요" : "사용 가능한 모델이 없어요"}</option>}
            {models.map(model => <option key={model.id} value={`${active}:${model.id}`}>{model.name}</option>)}
          </select>
        </label>
        {connected && agent.chatTarget && !selection && <p className="text-[12px] leading-relaxed text-busy">사용하던 모델을 사용할 수 없어요. 새 모델을 직접 선택해 주세요.</p>}
        {efforts.length > 0 && <fieldset disabled={!current || !connected} className="flex flex-col gap-2 disabled:opacity-50">
          <legend className="mb-2 text-[12px] font-medium text-fg-muted">Effort</legend>
          <div className="flex flex-wrap gap-1 rounded-md bg-bg-subtle p-1">{efforts.map(value => <label key={value} className={`relative flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-sm px-2 text-[12px] ${current?.effort === value ? "bg-bg-elevated text-fg shadow-[var(--shadow-xs)]" : "text-fg-muted hover:text-fg"}`}>
            <input type="radio" name="ai-effort" value={value} checked={current?.effort === value} onChange={() => agent.setEffort(value)} className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            <span className="pointer-events-none whitespace-nowrap rounded-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">{EFFORT_LABELS[value]}</span>
          </label>)}</div>
        </fieldset>}
      </div>

  </>;
}
