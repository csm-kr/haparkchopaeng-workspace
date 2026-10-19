"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUp, AtSign, BookOpen, FileText, List, Plus, Square, X } from "lucide-react";
import type { ResearchConversationDetail, ResearchConversationView, ResearchMaterialReference, ResearchPaperOption, ResearchPresentationOption } from "@/types/research-chat";
import { Button } from "@/components/ui";
import { useLocalAgent } from "@/components/local-agent/provider";
import { chatSelection } from "@/components/local-agent/chat-selection";
import { useResearchChat } from "./use-research-chat";
import { ConversationList } from "./conversation-list";
import { ChatDialog } from "./dialog";
import { Transcript } from "./transcript";
import type { ResearchChatApi } from "./client";
import { useAgentTasks } from "@/components/agent/use-agent-tasks";
import { AgentTaskList } from "@/components/agent/task-list";

export interface ResearchChatProps {
  teamId: string;
  initialPapers: ResearchPaperOption[];
  initialPresentations?: ResearchPresentationOption[];
  initialConversations: ResearchConversationView[];
  initialDetail?: ResearchConversationDetail | null;
  initialConversationId?: string;
  initialPaperId?: string;
  initialError?: string | null;
  api?: ResearchChatApi;
  agentTasksEnabled?: boolean;
  initialWork?: "seminar";
}

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
    if (revalidate) void refreshHistory.current();
  }, [agent?.phase]);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const pendingSelection = React.useRef<{ text: string; cursor: number } | null>(null);
  const popup = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();
  const [listOpen, setListOpen] = React.useState(false);
  const [mention, setMention] = React.useState<{ start: number; end: number; query: string; index: number } | null>(null);
  const [selections, setSelections] = React.useState<Record<string, ResearchMaterialReference[]>>(() => {
    const paper = props.initialPapers.find(item => item.id === props.initialPaperId);
    return { new: paper ? [{ kind: "paper", id: paper.id, title: paper.title }] : [] };
  });
  const key = chat.detail?.conversation.id ?? "new";
  const chosen = chat.blocked ? [] : selections[key] ?? [
    ...(chat.detail?.papers ?? []).map(paper => ({ kind: "paper" as const, id: paper.id, title: paper.title })),
    ...(chat.detail?.presentations ?? []).map(item => ({ kind: "presentation" as const, id: item.id, title: item.title })),
  ];
  const available: ResearchMaterialReference[] = [
    ...chat.papers.map(paper => ({ kind: "paper" as const, id: paper.id, title: paper.title })),
    ...chat.presentations.map(item => ({ kind: "presentation" as const, id: item.id, title: item.title })),
  ];
  const matches = available.filter(item => !chosen.some(selected => selected.id === item.id && selected.kind === item.kind) && item.title.toLocaleLowerCase().includes(mention?.query.toLocaleLowerCase() ?? ""));
  const activeIndex = Math.min(mention?.index ?? 0, Math.max(0, matches.length - 1));
  const target = chatSelection(agent?.device, agent?.chatTarget ?? agent?.selectedModel, agent?.effort);
  const work = useAgentTasks(Boolean(props.agentTasksEnabled) && !chat.blocked, chat.detail?.conversation.id);
  const execution = agent?.phase === "connected" && target && agent.device ? { deviceId: agent.device.id, ...target } : null;
  const taskPapers = chosen.filter(item => item.kind === "paper");
  const activeTurn = chat.detail?.turns.find(turn => ["preparing", "queued", "running"].includes(turn.status));
  const canSend = agent?.phase === "connected" && !!target && !!chat.prompt.trim() && !activeTurn && !chat.sending && !chat.loading && !chat.blocked;
  const empty = !chat.detail?.turns.length && !chat.loading && !work.tasks.length;
  const closeMention = React.useCallback(() => setMention(null), []);
  React.useEffect(() => { setMention(null); }, [key]);
  React.useEffect(() => {
    if (mention) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [mention, activeIndex, listId]);
  React.useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
    const selection = pendingSelection.current;
    pendingSelection.current = null;
    // Commit the edited value and caret together before another input can select text.
    if (selection?.text === chat.prompt) {
      element.focus();
      element.setSelectionRange(selection.cursor, selection.cursor);
    }
  }, [chat.prompt]);
  React.useEffect(() => {
    if (!mention) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !popup.current?.contains(event.target) && !input.current?.contains(event.target)) closeMention(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [mention, closeMention]);
  function detectMention(value: string, cursor: number) {
    const match = /(?:^|\s)@([^@\n]{0,100})$/.exec(value.slice(0, cursor));
    setMention(match ? { start: cursor - match[1].length - 1, end: cursor, query: match[1], index: 0 } : null);
  }
  function add(item: ResearchMaterialReference) {
    if (!mention || chosen.length >= 10) return;
    setSelections(previous => ({ ...previous, [key]: [...chosen, item] }));
    const text = chat.prompt.slice(0, mention.start) + chat.prompt.slice(mention.end);
    const cursor = mention.start;
    pendingSelection.current = { text, cursor };
    chat.setPrompt(text); closeMention();
  }
  function send() {
    if (!canSend || !target || !agent?.device) return;
    closeMention();
    const paperIds = chosen.filter(item => item.kind === "paper").map(item => item.id);
    const presentationIds = chosen.filter(item => item.kind === "presentation").map(item => item.id);
    void chat.submit(paperIds, { deviceId: agent.device.id, ...target, paperIds, presentationIds, prompt: chat.prompt.trim() });
  }
  function newChat() { chat.newChat(); setSelections(previous => ({ ...previous, new: [] })); setListOpen(false); closeMention(); }
  async function startTask() {
    if (!execution || taskPapers.length !== 1 || !chat.prompt.trim() || activeTurn || work.busyId) return;
    closeMention();
    if (await work.start({ ...execution, paperId: taskPapers[0].id, goal: chat.prompt.trim(), completion: "draft" })) chat.setPrompt("");
  }
  async function startSeminar() {
    if (!execution || taskPapers.length !== 1 || activeTurn || work.busyId) return;
    closeMention();
    const goal = chat.prompt.trim() || "선택한 논문으로 30분 연구 세미나를 준비해줘. 문제, 기여, 방법, 실험, 한계, 토론 질문과 원문 근거를 슬라이드로 구성해줘.";
    if (await work.start({ ...execution, paperId: taskPapers[0].id, goal, kind: "seminar", completion: "saved_presentation" })) chat.setPrompt("");
  }
  function open(id: string) { void chat.open(id); setListOpen(false); closeMention(); }
  const list = <ConversationList conversations={chat.conversations} selectedId={chat.detail?.conversation.id} onSelect={open} onNew={newChat} />;
  return <section aria-label="AI 연구 채팅" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <aside aria-label="대화 목록" className="hidden w-[232px] shrink-0 flex-col border-r border-border-token bg-bg-elevated p-3 xl:flex">{list}</aside>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2 sm:px-5">
        <Button variant="ghost" size="sm" aria-label="대화 목록 열기" className="min-h-10 xl:hidden" onClick={() => setListOpen(true)}><List size={17} aria-hidden="true" /></Button>
        <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg-muted">{chat.detail?.conversation.title ?? "새 대화"}</h1>
        <Button variant="ghost" size="sm" aria-label="새 대화" className="min-h-10 xl:hidden" onClick={newChat}><Plus size={17} aria-hidden="true" /></Button>
      </header>
      <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${empty ? "justify-center" : ""}`}>
        {chat.loading ? <div role="status" className="flex flex-1 items-center justify-center p-6 text-[13px] text-fg-muted">대화를 불러오고 있어요…</div> : empty ?
          <div className="mx-auto mb-7 w-full max-w-3xl px-6 text-center"><h2 className="text-[24px] font-semibold tracking-tight text-fg sm:text-[28px]">{props.initialWork === "seminar" ? "어떤 논문으로 세미나를 준비할까요?" : "무엇을 함께 생각해 볼까요?"}</h2>{props.initialWork === "seminar" && <p className="mt-3 text-[13px] text-fg-muted">@로 논문 한 편을 고르면 발표 구성과 슬라이드를 만들 수 있어요.</p>}</div> :
          <Transcript detail={chat.detail} onRetry={question => { chat.setPrompt(question); input.current?.focus(); }} activityKey={work.tasks.map(task => `${task.id}:${task.version}`).join(",")} taskContent={props.agentTasksEnabled && !chat.blocked ? <AgentTaskList tasks={work.tasks} busyId={work.busyId} connected={Boolean(execution)} onSave={(task, content) => { void work.save(task, content); }} onSeminarSave={(task, seminar) => { void work.saveSeminar(task, seminar); }} onControl={(task, control) => { void work.control(task, control, execution); }} /> : undefined}>{null}</Transcript>}
        <div className={`shrink-0 px-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6 ${empty ? "" : "pt-3"}`}>
          <form aria-label="연구 질문 보내기" onSubmit={event => { event.preventDefault(); send(); }} className="relative mx-auto flex w-full max-w-3xl flex-col rounded-xl border border-border-strong bg-bg-elevated p-3 shadow-[var(--shadow-xs)] focus-within:border-accent">
            {chosen.length > 0 && <div aria-label="첨부 자료" className="mb-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">{chosen.map(item => <span key={`${item.kind}:${item.id}`} className="inline-flex max-w-full items-center gap-1 rounded-sm bg-bg-subtle pl-2 text-[11px] text-fg-muted">
              {item.kind === "paper" ? <BookOpen size={12} aria-hidden="true" className="shrink-0" /> : <FileText size={12} aria-hidden="true" className="shrink-0" />}
              <Link href={`/${item.kind === "paper" ? "papers" : "presentations"}/${encodeURIComponent(item.id)}`} title={item.title} className="min-w-0 truncate py-1.5 hover:text-accent">{item.title}</Link>
              <button type="button" aria-label={`${item.title} 선택 해제`} disabled={chat.sending} onClick={() => setSelections(previous => ({ ...previous, [key]: chosen.filter(selected => selected.kind !== item.kind || selected.id !== item.id) }))} className="grid min-h-8 min-w-8 place-items-center rounded-sm hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"><X size={12} aria-hidden="true" /></button>
            </span>)}</div>}
            {mention && !chat.blocked && <div ref={popup} className="absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-lg border border-border-token bg-bg-elevated shadow-[var(--shadow-lg)]">
              <p className="flex items-center gap-2 border-b border-border-token px-3 py-2.5 text-[11px] text-fg-subtle"><AtSign size={13} aria-hidden="true" />논문 · 세미나 자료</p>
              <div id={listId} role="listbox" aria-label="팀 자료 검색 결과" className="max-h-64 overflow-y-auto p-1">
                {matches.map((item, index) => <button id={`${listId}-${index}`} key={`${item.kind}:${item.id}`} type="button" role="option" aria-selected={activeIndex === index} disabled={chosen.length >= 10} tabIndex={-1} onPointerDown={event => event.preventDefault()} onClick={() => add(item)} className={`flex min-h-11 w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-[13px] text-fg ${activeIndex === index ? "bg-bg-active" : "hover:bg-bg-hover"} disabled:opacity-50`}>
                  {item.kind === "paper" ? <BookOpen size={15} aria-hidden="true" className="shrink-0 text-fg-subtle" /> : <FileText size={15} aria-hidden="true" className="shrink-0 text-fg-subtle" />}<span className="min-w-0 flex-1 truncate">{item.title}</span><span className="shrink-0 text-[10px] text-fg-subtle">{item.kind === "paper" ? "논문" : "세미나"}</span>
                </button>)}
                {matches.length === 0 && <p className="px-3 py-5 text-[12px] text-fg-muted">{chat.materialsLoading ? "자료를 불러오고 있어요…" : "맞는 자료가 없어요."}</p>}
                {chosen.length >= 10 && <p className="px-3 py-2 text-[11px] text-fg-muted">한 번에 자료 10개까지 첨부할 수 있어요.</p>}
              </div>
            </div>}
            <textarea ref={input} aria-label="연구 질문" aria-autocomplete="list" aria-controls={mention ? listId : undefined} aria-activedescendant={mention && matches.length ? `${listId}-${activeIndex}` : undefined} value={chat.prompt}
              onChange={event => { chat.setPrompt(event.target.value); detectMention(event.target.value, event.target.selectionStart); }} maxLength={8000} rows={2} disabled={chat.blocked || chat.sending || chat.loading}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (mention) {
                  if (event.key === "Escape") { event.preventDefault(); closeMention(); return; }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMention({ ...mention, index: matches.length ? (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : 0 }); return; }
                  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (matches[activeIndex]) add(matches[activeIndex]); return; }
                }
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
              }} placeholder="무엇이든 물어보세요. @로 자료 추가" className="max-h-36 min-h-16 w-full resize-none bg-transparent px-1 py-1 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50" />
            <div className="flex items-center justify-between gap-2 pt-1">
              <button type="button" aria-label="자료 추가" title="자료 추가 (@)" disabled={chat.blocked || chat.sending || chat.loading} onClick={() => {
                const start = input.current?.selectionStart ?? chat.prompt.length;
                const text = `${chat.prompt.slice(0, start)}${start && !/\s/.test(chat.prompt[start - 1]) ? " " : ""}@${chat.prompt.slice(start)}`;
                const cursor = text.length - chat.prompt.slice(start).length;
                pendingSelection.current = { text, cursor };
                chat.setPrompt(text); detectMention(text, cursor); void chat.refreshMaterials();
              }} className="grid size-10 place-items-center rounded-lg text-fg-muted hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:opacity-50"><Plus size={20} aria-hidden="true" /></button>
              {activeTurn?.canCancel ? <button type="button" aria-label="답변 중지" disabled={chat.cancelling} onClick={() => void chat.cancel(activeTurn)} className="grid size-10 place-items-center rounded-lg bg-fg text-bg disabled:opacity-50"><Square size={15} fill="currentColor" aria-hidden="true" /></button> :
                <button type="submit" aria-label="보내기" disabled={!canSend} className="grid size-10 place-items-center rounded-lg bg-fg text-bg transition-colors hover:bg-fg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:bg-bg-active disabled:text-fg-faint"><ArrowUp size={19} aria-hidden="true" /></button>}
            </div>
          </form>
          {props.agentTasksEnabled && taskPapers.length === 1 && <div className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center gap-2"><Button type="button" variant="secondary" size="sm" disabled={!execution || !!activeTurn || !!work.busyId || chat.blocked || chat.loading} onClick={() => void startSeminar()}>세미나 자료 만들기</Button><Button type="button" variant="ghost" size="sm" disabled={!execution || !chat.prompt.trim() || !!activeTurn || !!work.busyId || chat.blocked || chat.loading} onClick={() => void startTask()}>{work.busyId === "new" ? "작업 요청 중…" : "노트 초안 만들기"}</Button><span className="min-w-0 truncate text-[11px] text-fg-subtle">{taskPapers[0].title}</span></div>}
          {props.agentTasksEnabled && work.loading && <p role="status" className="mx-auto mt-2 max-w-3xl text-[11px] text-fg-muted">작업 이력을 확인하고 있어요…</p>}
          {props.agentTasksEnabled && work.error && <div className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center gap-2"><p role="alert" className="text-[12px] text-busy">{work.error}</p><Button type="button" variant="ghost" size="sm" onClick={() => void work.refresh()}>작업 상태 다시 확인</Button></div>}
          {chat.error && <div className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center gap-2 px-1"><p role="alert" className="text-[12px] leading-relaxed text-busy">{chat.error}</p>{chat.blocked ? <Link href={chat.blockedTarget} className="text-[12px] text-accent">{chat.blockedTarget === "/" ? "다시 로그인" : "팀 확인"}</Link> : <Button variant="ghost" size="sm" onClick={() => void chat.refresh()}>상태 다시 확인</Button>}</div>}
        </div>
      </div>
    </div>
    {listOpen && <ChatDialog title="대화 목록" onClose={() => setListOpen(false)}>{list}</ChatDialog>}
  </section>;
}
