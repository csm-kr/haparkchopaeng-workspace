"use client";

import * as React from "react";
import type { ResearchChatTurn, ResearchChatTurnInput, ResearchConversationDetail, ResearchConversationView, ResearchPaperOption, ResearchPresentationOption } from "@/types/research-chat";
import { chatError, ResearchChatApiError, researchChatApi, type ResearchChatApi } from "./client";

export function useResearchChat({ initialPapers, initialPresentations = [], initialConversations, initialDetail, initialConversationId, initialError, api = researchChatApi }: {
  initialPapers: ResearchPaperOption[]; initialConversations: ResearchConversationView[]; initialDetail?: ResearchConversationDetail | null; initialConversationId?: string; initialError?: string | null; api?: ResearchChatApi;
  initialPresentations?: ResearchPresentationOption[];
}) {
  const [papers, setPapers] = React.useState(initialPapers);
  const [presentations, setPresentations] = React.useState(initialPresentations);
  const [materialsLoading, setMaterialsLoading] = React.useState(false);
  const [conversations, setConversations] = React.useState(initialConversations);
  const [detail, setDetail] = React.useState(initialDetail ?? null);
  const [prompt, setPrompt] = React.useState("");
  const [error, setError] = React.useState(initialError ?? null);
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [blocked, setBlocked] = React.useState(false);
  const [blockedTarget, setBlockedTarget] = React.useState("/");
  const [sourcePreparing, setSourcePreparing] = React.useState(false);
  const [sourceRequestedIds, setSourceRequestedIds] = React.useState<string[]>([]);
  const alive = React.useRef(true);
  const epoch = React.useRef(0);
  const atomic = React.useRef(false);
  const cancelAtomic = React.useRef(false);
  const sourceAtomic = React.useRef(false);
  const currentDetail = React.useRef(detail);
  const requestedId = React.useRef(initialDetail?.conversation.id ?? initialConversationId);
  currentDetail.current = detail;
  const currentPrompt = React.useRef(prompt);
  currentPrompt.current = prompt;
  const drafts = React.useRef(new Map<string, string>());
  const intent = React.useRef<{ fingerprint: string; createId: string; turnId: string; conversation?: ResearchConversationView } | null>(null);
  const valid = (revision: number) => alive.current && epoch.current === revision;

  React.useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current += 1; }; }, []);

  function fail(cause: unknown) {
    setError(chatError(cause));
    if (cause instanceof ResearchChatApiError && (cause.status === 401 || cause.status === 403)) {
      epoch.current += 1; setBlocked(true); setDetail(null); setConversations([]); setPapers([]); setPresentations([]); drafts.current.clear(); intent.current = null;
      atomic.current = false; cancelAtomic.current = false; setSending(false); setCancelling(false); setLoading(false);
      setBlockedTarget(cause.status === 401 ? "/" : "/teams");
      requestedId.current = undefined;
      sourceAtomic.current = false; setSourcePreparing(false); setSourceRequestedIds([]);
    }
  }
  function remember(conversation: ResearchConversationView) {
    setConversations((previous) => [conversation, ...previous.filter((item) => item.id !== conversation.id)]);
  }
  function putTurn(next: ResearchChatTurn) {
    setDetail((previous) => {
      if (!previous || previous.conversation.id !== next.conversationId) return previous;
      const old = previous.turns.find((turn) => turn.id === next.id);
      if (old && old.version > next.version) return previous;
      return { ...previous, turns: [...previous.turns.filter((turn) => turn.id !== next.id), next].sort((a, b) => a.conversationTurn - b.conversationTurn) };
    });
  }
  function url(id?: string, replace = false) {
    const path = id ? `/ai-chat/${encodeURIComponent(id)}` : "/ai-chat";
    if (window.location.pathname !== path) window.history[replace ? "replaceState" : "pushState"](null, "", path);
  }

  async function open(id: string, changeUrl = true) {
    drafts.current.set(currentDetail.current?.conversation.id ?? "new", currentPrompt.current);
    const revision = ++epoch.current;
    requestedId.current = id;
    sourceAtomic.current = false; setSourcePreparing(false); setSourceRequestedIds([]);
    atomic.current = false; cancelAtomic.current = false; intent.current = null;
    setSending(false); setCancelling(false); setLoading(true); setError(null); setDetail(null); setPrompt(drafts.current.get(id) ?? "");
    try {
      const next = await api.get(id);
      if (!valid(revision)) return;
      setDetail(next); remember(next.conversation); if (changeUrl) url(id);
    } catch (cause) { if (valid(revision)) fail(cause); }
    finally { if (valid(revision)) setLoading(false); }
  }
  function newChat(changeUrl = true) {
    drafts.current.set(currentDetail.current?.conversation.id ?? "new", currentPrompt.current);
    epoch.current += 1; atomic.current = false; cancelAtomic.current = false; intent.current = null;
    requestedId.current = undefined;
    sourceAtomic.current = false; setSourcePreparing(false); setSourceRequestedIds([]);
    setDetail(null); setPrompt(drafts.current.get("new") ?? ""); setError(null); setLoading(false); setSending(false); setCancelling(false);
    if (changeUrl) url();
  }
  React.useEffect(() => {
    const back = () => {
      const match = /^\/ai-chat\/([^/]+)\/?$/.exec(window.location.pathname);
      if (match) void open(decodeURIComponent(match[1]), false); else if (window.location.pathname === "/ai-chat") newChat(false);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  // Scope is mounted once; changing teams remounts the entire ResearchChat.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const revision = epoch.current;
    const id = currentDetail.current?.conversation.id ?? requestedId.current;
    try {
      const [nextPapers, nextPresentations, nextList, nextDetail] = await Promise.all([api.papers(), api.presentations(), api.list(), id ? api.get(id) : Promise.resolve(null)]);
      if (!valid(revision)) return;
      setPapers(nextPapers); setPresentations(nextPresentations); setConversations(nextList); setError(null);
      if (nextDetail) setDetail((previous) => {
        if (!previous) return nextDetail;
        if (previous.conversation.id !== nextDetail.conversation.id) return previous;
        const turns = nextDetail.turns.map((turn) => {
          const old = previous.turns.find((item) => item.id === turn.id);
          return old && old.version > turn.version ? old : turn;
        });
        return { ...nextDetail, turns: [...turns, ...previous.turns.filter((turn) => !turns.some((item) => item.id === turn.id))].sort((a, b) => a.conversationTurn - b.conversationTurn) };
      });
    } catch (cause) { if (valid(revision)) fail(cause); }
  }
  const id = detail?.conversation.id;
  const needsPolling = sending || !!intent.current || !!detail?.turns.some((turn) => ["preparing", "queued", "running"].includes(turn.status));
  React.useEffect(() => {
    if (!id || blocked || !needsPolling) return;
    let stopped = false, syncing = false;
    const revision = epoch.current;
    const poll = async () => {
      if (syncing || stopped) return;
      syncing = true;
      try {
        const next = await api.get(id);
        if (!stopped && valid(revision)) {
          for (const turn of next.turns) putTurn(turn);
          setDetail((previous) => previous?.conversation.id === id ? { ...previous, papers: next.papers, presentations: next.presentations, hasEarlierTurns: next.hasEarlierTurns } : previous);
          setError(null);
        }
      } catch (cause) { if (!stopped && valid(revision)) fail(cause); }
      finally { syncing = false; }
    };
    const interval = setInterval(() => void poll(), 1000);
    const focused = () => { if (document.visibilityState !== "hidden") void poll(); };
    window.addEventListener("focus", focused);
    return () => { stopped = true; clearInterval(interval); window.removeEventListener("focus", focused); };
  // API identity is stable and every response is guarded by the selected conversation epoch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id, blocked, needsPolling]);

  async function submit(paperIds: string[], input: Omit<ResearchChatTurnInput, "requestId">) {
    if (atomic.current || blocked) return;
    atomic.current = true; setSending(true); setError(null);
    const revision = epoch.current;
    const fingerprint = JSON.stringify({ paperIds, ...input });
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, createId: crypto.randomUUID(), turnId: crypto.randomUUID() };
    const pending = intent.current;
    try {
      const knownPapers = new Map([...(currentDetail.current?.papers ?? []), ...papers].map(paper => [paper.id, paper]));
      const knownPresentations = new Map([...(currentDetail.current?.presentations ?? []), ...presentations].map(item => [item.id, item]));
      const selectedPapers = paperIds.flatMap(id => { const paper = knownPapers.get(id); return paper ? [paper] : []; });
      const selectedPresentations = (input.presentationIds ?? []).flatMap(id => { const item = knownPresentations.get(id); return item ? [item] : []; });
      let conversation = currentDetail.current?.conversation ?? pending.conversation;
      if (!conversation) {
        conversation = await api.create({ requestId: pending.createId, paperIds, presentationIds: input.presentationIds ?? [], title: input.prompt.slice(0, 80) });
        pending.conversation = conversation;
        if (!valid(revision)) return;
        requestedId.current = conversation.id;
        setDetail({ conversation, papers: selectedPapers, presentations: selectedPresentations, turns: [], hasEarlierTurns: false });
        remember(conversation); url(conversation.id, true);
      }
      const next = await api.send(conversation.id, { ...input, requestId: pending.turnId });
      if (!valid(revision)) return;
      const updatedConversation = { ...conversation, paperIds, presentationIds: input.presentationIds ?? [], updatedAt: next.updatedAt };
      setDetail(previous => previous?.conversation.id === conversation.id ? { ...previous, conversation: updatedConversation, papers: selectedPapers, presentations: selectedPresentations } : previous);
      putTurn(next); setPrompt(""); drafts.current.delete("new"); drafts.current.delete(conversation.id); intent.current = null;
      remember(updatedConversation);
    } catch (cause) { if (valid(revision)) fail(cause); }
    finally { if (valid(revision)) { atomic.current = false; setSending(false); } }
  }
  async function cancel(turn: ResearchChatTurn) {
    if (!turn.canCancel || cancelAtomic.current || blocked) return;
    cancelAtomic.current = true; setCancelling(true); setError(null);
    const revision = epoch.current;
    try { const next = await api.cancel(turn.conversationId, turn.id); if (valid(revision)) putTurn(next); }
    catch (cause) { if (valid(revision)) fail(cause); }
    finally { if (valid(revision)) { cancelAtomic.current = false; setCancelling(false); } }
  }
  async function prepareSources(paperIds: string[]) {
    if (sourceAtomic.current || blocked || !paperIds.length || paperIds.length > 3) return;
    const revision = epoch.current;
    sourceAtomic.current = true; setSourcePreparing(true); setError(null);
    try {
      await api.prepareSources(paperIds);
      if (valid(revision)) {
        const clearSourceError = (paper: ResearchPaperOption) => paperIds.includes(paper.id) ? { ...paper, sourceError: null } : paper;
        setPapers((previous) => previous.map(clearSourceError));
        setDetail((previous) => previous ? { ...previous, papers: previous.papers.map(clearSourceError) } : previous);
        setSourceRequestedIds(paperIds);
      }
    } catch (cause) {
      if (valid(revision)) {
        fail(cause);
        if (!(cause instanceof ResearchChatApiError && (cause.status === 401 || cause.status === 403))) setError("본문 준비를 요청하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      }
    } finally { if (valid(revision)) { sourceAtomic.current = false; setSourcePreparing(false); } }
  }
  async function refreshMaterials() {
    if (blocked || materialsLoading) return;
    const revision = epoch.current;
    setMaterialsLoading(true);
    try {
      const [nextPapers, nextPresentations] = await Promise.all([api.papers(), api.presentations()]);
      if (valid(revision)) { setPapers(nextPapers); setPresentations(nextPresentations); }
    } catch (cause) { if (valid(revision)) fail(cause); }
    finally { if (alive.current) setMaterialsLoading(false); }
  }
  return { papers, presentations, materialsLoading, refreshMaterials, conversations, detail, prompt, setPrompt, error, loading, sending, cancelling, blocked, blockedTarget, sourcePreparing, sourceRequestedIds, open, newChat, refresh, submit, cancel, prepareSources };
}
