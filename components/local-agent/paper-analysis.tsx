"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ui";
import type { AnalysisStatus } from "@/types";
import { useLocalAgent } from "./provider";
import { LocalAgentModelPicker } from "./model-picker";

interface State { analysisStatus: string; analysisError?: string | null; runId?: string | null; canCancel?: boolean; sourceReady?: boolean; sourceHasOcr?: boolean }
class AnalysisApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function call(paperId: string, method: "GET" | "POST" | "DELETE", input?: object, signal?: AbortSignal): Promise<State> {
  const result = await fetch(`/api/papers/${encodeURIComponent(paperId)}/reanalyze`, { method, cache: "no-store", signal, ...(input ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}) });
  const body = await result.json().catch(() => null) as { data?: State; error?: { message?: string } } | null;
  if (!result.ok || !body?.data) throw new AnalysisApiError(body?.error?.message || (result.status === 401 || result.status === 403 ? "로그인과 AI 연결을 다시 확인해주세요." : "분석 상태를 확인하지 못했어요. 잠시 후 다시 시도해주세요."), result.status);
  return body.data;
}

export function LocalPaperAnalysis({ paperId, initialStatus }: { paperId: string; initialStatus: AnalysisStatus }) {
  const agent = useLocalAgent(), router = useRouter();
  const [state, setState] = React.useState<State>({ analysisStatus: initialStatus });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const intent = React.useRef<{ fingerprint: string; requestId: string } | null>(null);
  const mutation = React.useRef(0), submittedRun = React.useRef<string | null>(null);
  const operating = React.useRef(false), alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  React.useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function sync() {
      const revision = mutation.current;
      try {
        const next = await call(paperId, "GET", undefined, controller.signal);
        if (stopped || revision !== mutation.current) return;
        setState(next);
        if (next.runId === submittedRun.current && next.analysisStatus !== "pending") { intent.current = null; submittedRun.current = null; }
        if (next.analysisStatus !== initialStatus) router.refresh();
        if (next.analysisStatus === "pending") timer = setTimeout(() => void sync(), 2500);
      } catch (value) {
        if (stopped || revision !== mutation.current) return;
        setError(value instanceof Error ? value.message : "분석 상태를 확인하지 못했어요.");
        timer = setTimeout(() => void sync(), 5000);
      }
    }
    void sync();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [paperId, initialStatus, state.runId, router]);

  async function start() {
    if (operating.current || agent?.phase !== "connected" || !agent.device || !agent.selectedModel) return;
    operating.current = true; mutation.current++; setBusy(true); setError(null);
    const selection = { deviceId: agent.device.id, ...agent.selectedModel };
    const fingerprint = JSON.stringify([paperId, selection]);
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const next = await call(paperId, "POST", { ...selection, requestId: intent.current.requestId });
      if (alive.current) {
        submittedRun.current = next.runId ?? null;
        if (next.analysisStatus !== "pending") intent.current = null;
        setState({ ...next, canCancel: next.analysisStatus === "pending" }); router.refresh();
      }
    } catch (value) {
      // A gateway/server failure can hide an already-admitted run. Confirm that
      // same intent before a later explicit request is allowed to create one.
      if (value instanceof AnalysisApiError && value.status >= 400 && value.status < 500) intent.current = null;
      if (alive.current) setError(value instanceof Error ? value.message : "분석을 시작하지 못했어요.");
    }
    finally { operating.current = false; if (alive.current) setBusy(false); }
  }
  async function cancel() {
    if (operating.current) return;
    operating.current = true; mutation.current++; setBusy(true); setError(null);
    try {
      const next = await call(paperId, "DELETE");
      if (alive.current) { setState(next); intent.current = null; router.refresh(); }
    } catch (value) { if (alive.current) setError(value instanceof Error ? value.message : "분석을 중단하지 못했어요."); }
    finally { operating.current = false; if (alive.current) setBusy(false); }
  }
  const running = state.analysisStatus === "pending" && Boolean(state.runId);
  const connected = agent?.phase === "connected" && Boolean(agent.device);
  return <Card id="local-paper-analysis" className="flex flex-col gap-4 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-[14px] font-semibold text-fg">AI 논문 분석</h2><p className="mt-1 text-[12px] leading-relaxed text-fg-muted">내 PC의 AI로 연구·재구현 분석을 만들어요. 원문 근거를 함께 확인해주세요.</p></div>
      <Link href={`/ai-chat?paperId=${encodeURIComponent(paperId)}`} className="text-[12px] font-medium text-accent hover:underline">AI 채팅에서 질문하기</Link>
    </div>
    {!connected && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[13px] text-fg-muted">AI를 연결하고 사용할 모델을 선택해주세요.</p><Button size="sm" variant="secondary" onClick={() => agent?.open()}>AI 연결</Button></div>}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><LocalAgentModelPicker /></div><Button onClick={() => void start()} disabled={busy || running || !connected || !agent?.selectedModel}>{busy ? "분석 접수 중…" : "이 AI로 분석"}</Button></div>
    {state.analysisStatus === "pending" && <div role="status" className="flex flex-wrap items-center gap-2 text-[13px] text-fg-muted"><Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /><span>{running ? "연결한 AI가 분석하고 있어요. 이 웹페이지를 열어두세요." : "PDF 본문을 준비하고 있어요."}</span>{state.canCancel && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>분석 중단</Button>}</div>}
    {state.analysisStatus === "awaiting_ai" && !state.analysisError && <p role="status" className="text-[12px] text-fg-muted">모델을 선택한 뒤 분석을 시작할 수 있어요.</p>}
    {(error || state.analysisError) && <p role="alert" className="text-[13px] text-busy">{error || state.analysisError}</p>}
    <p className="text-[11px] text-fg-subtle">{state.sourceHasOcr
      ? "스캔 페이지를 문자 인식으로 읽었어요. 중요한 수치·인용은 원문 PDF와 함께 확인해주세요."
      : "본문·캡션을 바탕으로 분석해요. 그림 속 수치는 원문에서 확인해주세요."}</p>
  </Card>;
}
