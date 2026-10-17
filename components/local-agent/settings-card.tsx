"use client";

import * as React from "react";
import Link from "next/link";
import { Monitor } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useLocalAgent } from "./provider";
import { phaseLabel } from "./presentation";
import { LocalAgentModelPicker } from "./model-picker";
import { LocalAgentProviderList } from "./provider-list";
import { LocalAgentClientResume } from "./client-resume";

export interface AgentPaperOption { id: string; title: string }

export function LocalAgentSettingsCard({ papers = [] }: { papers?: AgentPaperOption[] }) {
  const agent = useLocalAgent();
  const [paperId, setPaperId] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  if (!agent) return null;
  const working = agent.jobBusy || agent.job?.status === "queued" || agent.job?.status === "running";
  const canSubmit = agent.phase === "connected" && !!agent.selectedModel && !!paperId && !!prompt.trim() && !working;
  return <Card role="region" className="flex flex-col gap-4 p-5" aria-labelledby="local-agent-settings-title">
    <LocalAgentClientResume />
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="local-agent-settings-title" className="text-[20px] font-semibold text-fg">AI 연결</h2>
        <p className="text-[12px] leading-relaxed text-fg-muted">이 PC의 Codex·Claude Code로 논문을 읽고 질문해요.</p>
      </div>
      <Monitor size={18} aria-hidden="true" className="mt-1 shrink-0 text-fg-subtle" />
    </div>
    {agent.phase === "loading" ? <div role="status" className="rounded-md bg-bg-subtle p-3 text-[12px] text-fg-muted">연결을 확인하고 있어요…</div> : <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg-subtle px-3 py-2">
      <span className="inline-flex min-w-0 items-center gap-2 text-[13px] text-fg"><span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${agent.phase === "connected" ? "bg-online" : "bg-fg-subtle"}`} /><span className="truncate">{agent.phase === "connected" ? agent.device?.name : phaseLabel[agent.phase]}</span></span>
      <Button size="sm" variant="secondary" onClick={agent.open}>{agent.phase === "connected" ? "연결 관리" : "AI 연결"}</Button>
    </div>}
    {agent.message && <p role="alert" className="text-[12px] leading-relaxed text-busy">{agent.message}</p>}
    {agent.device && <LocalAgentProviderList />}
    <LocalAgentModelPicker />
    {!agent.selectedModel && <p className="text-[12px] text-fg-muted">모델을 직접 고른 뒤 질문할 수 있어요.</p>}
    <form className="flex flex-col gap-3 border-t border-border-token pt-4" onSubmit={(event) => { event.preventDefault(); if (canSubmit) void agent.submitJob(paperId, prompt); }}>
      <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-fg-muted">질문할 논문</span>
        <select aria-label="질문할 논문" value={paperId} onChange={(event) => setPaperId(event.target.value)} disabled={papers.length === 0 || working}
          className="min-h-11 w-full rounded-sm border border-border-strong bg-bg-elevated px-3 text-[13px] text-fg focus:outline-none focus:ring-[3px] focus:ring-accent-soft disabled:opacity-50">
          <option value="">논문을 선택하세요</option>{papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.title}</option>)}
        </select>
      </label>
      {papers.length === 0 && <p className="text-[12px] text-fg-muted">아직 질문할 논문이 없어요. <Link href="/library" className="text-accent underline-offset-2 hover:underline">논문을 먼저 올려 주세요.</Link></p>}
      <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-fg-muted">논문 질문</span>
        <textarea aria-label="논문 질문" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={8000} rows={3} disabled={working}
          placeholder="이 논문의 핵심 기여와 한계를 설명해 주세요."
          className="w-full resize-y rounded-sm border border-border-strong bg-bg-elevated px-3 py-2 text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-[3px] focus:ring-accent-soft disabled:opacity-50" />
      </label>
      <p className="text-[11px] leading-relaxed text-fg-muted">선택한 논문의 분석 자료와 질문을 이 PC의 AI에 전달해요.</p>
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={!canSubmit}>{working ? "답변을 기다리고 있어요…" : "질문 보내기"}</Button>{working && agent.job && <Button variant="secondary" onClick={() => void agent.cancelJob()}>질문 취소</Button>}</div>
    </form>
    {agent.job && <section aria-label="AI 답변" className="flex flex-col gap-2 rounded-md border border-border-token bg-bg-subtle p-4">
      <span role="status" className="text-[12px] font-medium text-fg-muted">{agent.job.status === "queued" ? "이 PC의 AI가 질문을 기다리고 있어요" : agent.job.status === "running" ? "논문을 읽고 답변하고 있어요…" : agent.job.status === "completed" ? "답변이 도착했어요" : agent.job.status === "cancelled" ? "질문을 취소했어요" : "답변을 완료하지 못했어요. 연결과 공급자 상태를 확인해 주세요."}</span>
      {agent.job.response && <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">{agent.job.response}</p>}
    </section>}
    {agent.device && <div className="flex flex-wrap items-center gap-2 border-t border-border-token pt-3">
      <Button size="sm" variant="ghost" onClick={() => void agent.refresh()}>상태 다시 확인</Button>
      {confirmDisconnect ? <><span className="text-[12px] text-fg-muted">이 PC의 실행 권한을 해제할까요?</span><Button size="sm" variant="danger" onClick={() => { setConfirmDisconnect(false); void agent.disconnect(); }}>연결 해제</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)}>취소</Button></> : <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)}>이 PC 연결 해제</Button>}
    </div>}
  </Card>;
}
