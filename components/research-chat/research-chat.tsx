"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, List, Plus, Send, Square, X } from "lucide-react";
import type { ResearchConversationDetail, ResearchConversationView, ResearchPaperOption } from "@/types/research-chat";
import { Button } from "@/components/ui";
import { LocalAgentModelPicker } from "@/components/local-agent/model-picker";
import { useLocalAgent } from "@/components/local-agent/provider";
import { QuotaBadge } from "@/components/local-agent/quota-badge";
import { providerName, providerStatus, quotaWindows } from "@/components/local-agent/presentation";
import { PaperPicker } from "./paper-picker";
import { useResearchChat } from "./use-research-chat";
import { ConversationList } from "./conversation-list";
import { ChatDialog } from "./dialog";
import { Transcript } from "./transcript";
import type { ResearchChatApi } from "./client";

export interface ResearchChatProps {
  teamId: string;
  initialPapers: ResearchPaperOption[];
  initialConversations: ResearchConversationView[];
  initialDetail?: ResearchConversationDetail | null;
  initialConversationId?: string;
  initialPaperId?: string;
  initialError?: string | null;
  api?: ResearchChatApi;
}

const starters = [
  { label: "논문 요약", prompt: "선택한 논문별 문제·핵심 기여·방법·한계를 원문 근거와 함께 정리해 주세요." },
  { label: "논문 비교", prompt: "선택한 논문의 문제 설정·방법·실험 조건·결과·한계를 비교하고, 직접 비교할 수 없는 조건을 구분해 주세요." },
  { label: "재현 계획", prompt: "선택한 논문에서 확인되는 데이터·모델·학습 조건과, 재현에 빠진 정보·확인 순서를 제안해 주세요." },
  { label: "세미나 질문", prompt: "선택한 논문을 이해 확인·가정 검토·실험 한계·후속 연구로 나누어 토론 질문을 제안해 주세요." },
];

export function ResearchChat(props: ResearchChatProps) {
  return <ScopedResearchChat key={props.teamId} {...props} />;
}

function ScopedResearchChat(props: ResearchChatProps) {
  const agent = useLocalAgent();
  const chat = useResearchChat(props);
  const previousConnectionPhase = React.useRef<string | undefined>(undefined);
  const refreshHistory = React.useRef(chat.refresh);
  refreshHistory.current = chat.refresh;
  React.useEffect(() => {
    const phase = agent?.phase;
    const revalidate = phase === "login_required" && previousConnectionPhase.current !== phase;
    previousConnectionPhase.current = phase;
    // A grant can expire while private history remains readable. Let its own API decide.
    if (revalidate) void refreshHistory.current();
  }, [agent?.phase]);
  const { prompt, setPrompt } = chat;
  const [selected, setSelected] = React.useState<string[]>(() => props.initialPaperId && props.initialPapers.some((paper) => paper.id === props.initialPaperId) ? [props.initialPaperId] : []);
  const [paperPicker, setPaperPicker] = React.useState(false);
  const [listOpen, setListOpen] = React.useState(false);
  const [compare, setCompare] = React.useState(false);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const chosen = chat.detail?.papers ?? chat.papers.filter((paper) => selected.includes(paper.id));
  const sourceReady = chosen.length > 0 && chosen.every((paper) => paper.sourceReady);
  const unprepared = chosen.filter((paper) => !paper.sourceReady);
  const failedSources = unprepared.filter((paper) => paper.sourceError);
  const sourcesRequested = unprepared.length > 0 && unprepared.every((paper) => chat.sourceRequestedIds.includes(paper.id));
  const activeTurn = chat.detail?.turns.find((turn) => turn.status === "queued" || turn.status === "running");
  const canSend = agent?.phase === "connected" && !!agent.selectedModel && sourceReady && !!prompt.trim() && (!compare || chosen.length >= 2) && !activeTurn && !chat.sending && !chat.loading && !chat.blocked;
  function send() {
    if (!canSend || !agent?.selectedModel || !agent.device) return;
    void chat.submit(chosen.map((paper) => paper.id), { deviceId: agent.device.id, ...agent.selectedModel, prompt: prompt.trim() });
  }
  const selectedProvider = agent?.device?.providers.find((provider) => provider.provider === agent.selectedModel?.provider);
  function newChat() { chat.newChat(); setSelected([]); setCompare(false); setListOpen(false); }
  function open(id: string) { void chat.open(id); setSelected([]); setCompare(false); setListOpen(false); }
  const list = <ConversationList conversations={chat.conversations} selectedId={chat.detail?.conversation.id} onSelect={open} onNew={newChat} />;
  return <section aria-label="AI 연구 채팅" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <aside aria-label="대화 목록" className="hidden w-[232px] shrink-0 flex-col border-r border-border-token bg-bg-elevated p-3 xl:flex">{list}</aside>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-token px-3 py-2 sm:px-5">
        <Button variant="ghost" size="sm" aria-label="대화 목록 열기" className="min-h-10 xl:hidden" onClick={() => setListOpen(true)}><List size={16} aria-hidden="true" /></Button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5"><h1 className="truncate text-[14px] font-semibold text-fg">{chat.detail?.conversation.title ?? "새 대화"}</h1><p className="truncate text-[11px] text-fg-muted">이 팀에서 나만 보는 대화예요.</p></div>
        <Button variant="ghost" size="sm" aria-label="새 대화" className="min-h-10 xl:hidden" onClick={newChat}><Plus size={15} aria-hidden="true" /></Button>
      </header>
      {chat.loading ? <div role="status" className="flex flex-1 items-center justify-center p-6 text-[13px] text-fg-muted">대화를 불러오고 있어요…</div> : <Transcript detail={chat.detail} onRetry={(question) => { setPrompt(question); setCompare(false); input.current?.focus(); }}>
        <div className="flex flex-col gap-5 py-5 sm:py-10">
          <div className="flex flex-col gap-2"><BookOpen size={22} aria-hidden="true" className="text-fg-subtle" /><h2 className="text-[20px] font-semibold text-fg">논문을 함께 읽고, 질문을 이어가요.</h2><p className="max-w-lg text-[13px] leading-relaxed text-fg-muted">팀 논문 1~3편을 골라 요약부터 재현 계획까지 물어보세요. 답변은 이 대화에 보관돼요.</p></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{starters.map((starter) => <Button key={starter.label} variant="secondary" className="min-h-11 justify-start" onClick={() => { setPrompt(starter.prompt); setCompare(starter.label === "논문 비교"); input.current?.focus(); }}>{starter.label}</Button>)}</div>
        </div>
      </Transcript>}
      <div className="shrink-0 border-t border-border-token bg-bg-elevated px-3 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6">
        <form aria-label="연구 질문 보내기" className="mx-auto flex w-full max-w-3xl flex-col gap-2" onSubmit={(event) => { event.preventDefault(); send(); }}>
          <div className="flex flex-wrap items-center gap-1.5">
            {!chat.detail && <Button size="sm" variant="ghost" className="min-h-10" disabled={chat.sending || chat.blocked} onClick={() => { setPaperPicker(true); void chat.refresh(); }}><BookOpen size={14} aria-hidden="true" />팀 논문 선택 ({selected.length}/3)</Button>}
            {chosen.map((paper) => <span key={paper.id} className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border-token bg-bg-subtle px-2 text-[11px] text-fg-muted">
              <Link href={`/papers/${encodeURIComponent(paper.id)}`} className="min-w-0 truncate py-2 hover:text-accent" title={paper.title}>{paper.title}</Link>
              {!chat.detail && <button type="button" disabled={chat.sending} aria-label={`${paper.title} 선택 해제`} onClick={() => setSelected(selected.filter((id) => id !== paper.id))} className="grid min-h-10 min-w-8 shrink-0 place-items-center rounded-sm hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"><X size={12} aria-hidden="true" /></button>}
            </span>)}
          </div>
          {chat.detail && <p className="text-[11px] text-fg-subtle">이 대화의 근거 논문이에요. 다른 논문은 새 대화에서 선택해 주세요.</p>}
          {chat.papers.length === 0 && !chat.blocked && <p className="text-[12px] text-fg-muted">아직 선택할 논문이 없어요. <Link href="/library" className="text-accent underline-offset-2 hover:underline">논문을 먼저 올려 주세요.</Link></p>}
          {compare && chosen.length < 2 && <p className="text-[12px] text-fg-muted">비교할 논문을 한 편 더 선택해 주세요.</p>}
          {unprepared.length > 0 && <div className="flex flex-wrap items-center gap-1">
            {failedSources.length ? <div role="alert" className="w-full text-[12px] leading-relaxed text-busy">
              {failedSources.map((paper) => <p key={paper.id} className="break-words">{paper.title}: {paper.sourceError}</p>)}
            </div> : <p role="status" className="text-[12px] text-fg-muted">{sourcesRequested ? "본문을 준비하고 있어요. 잠시 후 상태를 다시 확인해 주세요." : "선택한 논문에 본문 준비가 필요해요."}</p>}
            <Button variant="secondary" size="sm" className="min-h-10" disabled={chat.sourcePreparing || chat.blocked} onClick={() => void chat.prepareSources(unprepared.map((paper) => paper.id))}>{chat.sourcePreparing ? "본문 준비 요청 중…" : failedSources.length ? "본문 준비 다시 시도" : "본문 준비"}</Button>
            <Button variant="ghost" size="sm" className="min-h-10" onClick={() => void chat.refresh()}>본문 다시 확인</Button>
          </div>}
          <textarea ref={input} aria-label="연구 질문" aria-describedby="research-chat-input-help" value={prompt} onChange={(event) => { setPrompt(event.target.value); setCompare(false); }} maxLength={8000} rows={2} disabled={chat.blocked || chat.sending || chat.loading}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); send(); } }}
            placeholder="논문에 대해 궁금한 점을 물어보세요…" className="max-h-36 min-h-20 w-full resize-y rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-[14px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-[3px] focus:ring-accent-soft disabled:opacity-50" />
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
            <div className="flex min-w-0 max-w-full flex-1 items-end gap-1"><div className="min-w-0 max-w-full flex-1 sm:max-w-xs"><LocalAgentModelPicker /></div>{selectedProvider && <QuotaBadge windows={quotaWindows(selectedProvider)} />}</div>
            {activeTurn?.canCancel ? <Button disabled={chat.cancelling} variant="secondary" className="min-h-11" onClick={() => void chat.cancel(activeTurn)}><Square size={13} aria-hidden="true" />{chat.cancelling ? "중지 확인 중…" : "답변 중지"}</Button> : <Button type="submit" disabled={!canSend} className="min-h-11"><Send size={14} aria-hidden="true" />{chat.sending ? "질문 보내는 중…" : "보내기"}</Button>}
          </div>
          {agent?.phase === "loading" ? <p role="status" className="text-[12px] text-fg-muted">연결을 확인하고 있어요…</p> : agent?.phase !== "connected" && !chat.blocked ? <div className="flex flex-wrap items-center gap-1 text-[12px] text-fg-muted"><p>내 PC의 AI를 연결하면 질문을 보낼 수 있어요.</p><Button variant="ghost" size="sm" className="min-h-10 text-accent" onClick={agent?.open}>AI 연결</Button></div> : !agent?.selectedModel && !chat.blocked ? <p className="text-[12px] text-fg-muted">사용할 모델을 직접 선택해 주세요.</p> : null}
          {agent?.device?.providers.filter((provider) => provider.status !== "ready").map((provider) => <p key={provider.provider} className="text-[12px] text-fg-muted">{providerName[provider.provider]} · {providerStatus[provider.status]}</p>)}
          {activeTurn && !activeTurn.canCancel && <p className="text-[12px] text-fg-muted">이전 웹 세션에서 시작한 작업이에요. 현재 상태를 확인하고 있어요.</p>}
          {chat.error && <div className="flex flex-wrap items-center gap-2 rounded-md bg-bg-subtle px-3 py-2"><p role="alert" className="text-[12px] leading-relaxed text-busy">{chat.error}</p>{chat.blocked ? <Link href={chat.blockedTarget} className="text-[12px] text-accent underline-offset-2 hover:underline">{chat.blockedTarget === "/" ? "다시 로그인" : "팀 확인"}</Link> : <Button variant="ghost" size="sm" className="min-h-10" onClick={() => void chat.refresh()}>상태 다시 확인</Button>}</div>}
          <p id="research-chat-input-help" className="text-[10px] leading-relaxed text-fg-subtle">선택한 논문 자료와 대화를 내 PC의 CLI·AI 공급자에 전달해요. Enter 전송 · Shift+Enter 줄바꿈</p>
        </form>
      </div>
    </div>
    {paperPicker && <PaperPicker papers={chat.papers} selected={selected} onSelect={setSelected} onClose={() => setPaperPicker(false)} />}
    {listOpen && <ChatDialog title="대화 목록" onClose={() => setListOpen(false)}>{list}</ChatDialog>}
  </section>;
}
