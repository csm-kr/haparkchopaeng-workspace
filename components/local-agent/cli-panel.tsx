"use client";

import * as React from "react";
import Link from "next/link";
import { SquareTerminal } from "lucide-react";
import type { LocalAgentActiveJobView, LocalAgentProvider as ProviderName } from "@/types/local-agent";
import { Button } from "@/components/ui";
import { errorMessage, LocalAgentApiError } from "./client";
import { providerName } from "./presentation";
import { useLocalAgent } from "./provider";

const KIND_LABEL: Record<LocalAgentActiveJobView["kind"], string> = { chat: "AI 채팅", paper_analysis: "논문 분석", agent_task: "노트·세미나 작업", question: "논문 질문" };
const STATUS_LABEL: Record<LocalAgentActiveJobView["status"], string> = { preparing: "자료 준비 중", queued: "대기 중", running: "실행 중" };

function terminalError(error: unknown): string {
  if (error instanceof LocalAgentApiError && error.code === "CONNECTOR_UPDATE_REQUIRED") return "터미널을 열려면 AI 브릿지를 업데이트해 주세요.";
  if (error instanceof LocalAgentApiError && error.code === "PROVIDER_NOT_INSTALLED") return "연결된 PC에 이 CLI가 설치돼 있지 않아요.";
  return errorMessage(error);
}

/** Asks the connected app to open a user-managed CLI terminal (ADR-034). Only the provider name is sent. */
export function TerminalButton({ provider }: { provider: ProviderName }) {
  const agent = useLocalAgent();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; error: boolean } | null>(null);
  React.useEffect(() => { setMessage(null); }, [provider]);
  const device = agent?.device;
  if (!agent || agent.phase !== "connected" || !device) return null;
  if (!device.bridgeCapabilities?.includes("terminal_v1")) return <p className="text-[12px] leading-relaxed text-fg-muted">터미널 열기는 AI 브릿지 0.1.13부터 쓸 수 있어요.</p>;
  const snapshot = device.providers.find(item => item.provider === provider);
  if (!snapshot || snapshot.status === "not_installed") return null;
  const target = device;
  async function open() {
    setBusy(true); setMessage(null);
    try {
      await agent!.api.openTerminal(target.id, provider);
      setMessage({ text: `연결된 PC(${target.name})에서 터미널을 여는 중이에요. 몇 초 안에 열려요.`, error: false });
    } catch (error) { setMessage({ text: terminalError(error), error: true }); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-2">
    <Button type="button" variant="secondary" size="sm" className="min-h-10 self-start" disabled={busy} onClick={() => void open()}>
      <SquareTerminal size={14} aria-hidden="true" />{providerName[provider]} 터미널 열기
    </Button>
    {message && <p role={message.error ? "alert" : "status"} className={`text-[12px] leading-relaxed ${message.error ? "text-busy" : "text-fg-muted"}`}>{message.text}</p>}
  </div>;
}

/** This web session's queued/running work while the connection window is open. Status only; chat answers can be stopped. */
export function ActiveJobs() {
  const agent = useLocalAgent();
  const api = agent?.api;
  const headingId = React.useId();
  const [jobs, setJobs] = React.useState<LocalAgentActiveJobView[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [stopping, setStopping] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    if (!api) return;
    try { setJobs(await api.activeJobs()); setFailed(false); } catch { setFailed(true); }
  }, [api]);
  React.useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 5000);
    const focused = () => { if (document.visibilityState !== "hidden") void load(); };
    window.addEventListener("focus", focused);
    return () => { clearInterval(timer); window.removeEventListener("focus", focused); };
  }, [load]);
  async function stop(id: string) {
    if (!api) return;
    setStopping(id);
    try { await api.cancelJob(id); } catch { setFailed(true); }
    finally { setStopping(null); void load(); }
  }
  return <section aria-labelledby={headingId} className="flex flex-col gap-2 border-t border-border-token pt-3">
    <h3 id={headingId} className="text-[12px] font-medium text-fg-muted">실행 중인 작업</h3>
    {failed ? <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-[12px] text-busy">실행 중인 작업을 확인하지 못했어요.</p><Button type="button" variant="ghost" size="sm" onClick={() => void load()}>다시 시도</Button></div>
      : jobs === null ? <p role="status" className="text-[12px] text-fg-muted">작업을 확인하고 있어요…</p>
      : jobs.length === 0 ? <p className="text-[12px] text-fg-muted">지금 실행 중인 작업이 없어요.</p>
      : <ul className="flex flex-col gap-1">{jobs.map(job => <li key={job.id} aria-label={`${KIND_LABEL[job.kind]} ${STATUS_LABEL[job.status]}`} className="flex min-h-11 items-center gap-2 rounded-sm bg-bg-subtle px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-fg">{KIND_LABEL[job.kind]} <span className="font-normal text-fg-muted">· {STATUS_LABEL[job.status]}</span></p>
          <p className="truncate font-mono text-[11px] text-fg-muted">{providerName[job.provider]} · {job.model}</p>
        </div>
        {job.href && <Link href={job.href} className="shrink-0 rounded-sm px-1 text-[12px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft">열기</Link>}
        {job.canCancel && <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={stopping === job.id} onClick={() => void stop(job.id)}>멈추기</Button>}
      </li>)}</ul>}
  </section>;
}
