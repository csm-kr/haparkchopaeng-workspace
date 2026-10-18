"use client";

import { Check, Monitor } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { ConnectionDialog } from "./connection-dialog";
import { useLocalAgent } from "./provider";
import { LocalAgentModelPicker } from "./model-picker";
import { LocalAgentProviderList } from "./provider-list";
import { InstallHelp } from "./install-help";

export function ConnectionModal({ onClose }: { onClose: () => void }) {
  const agent = useLocalAgent();
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
      <LocalAgentProviderList />
      <LocalAgentModelPicker />
      <p className="text-[12px] leading-relaxed text-fg-muted">설정의 AI 연결에서 논문을 골라 질문할 수 있어요.</p>
      <Button onClick={onClose}>완료</Button>
    </> : <>
      <div className="flex flex-col gap-2" aria-live="polite">
        <h3 className="text-[16px] font-semibold text-fg">{agent.phase === "creating" ? "연결을 준비하고 있어요" : agent.phase === "awaiting_code" ? "웹의 번호를 AI 브릿지에 입력해 주세요" : agent.phase === "opening" ? "AI 브릿지를 열고 있어요" : agent.phase === "expired" ? "연결 번호가 만료됐어요" : agent.phase === "cancelled" ? "연결을 취소했어요" : agent.phase === "login_required" ? "다시 로그인해 주세요" : agent.phase === "offline" ? "AI 브릿지를 다시 열어 주세요" : "내 PC의 AI를 연결해요"}</h3>
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
      {agent.fallback && <InstallHelp />}
      {!pending && agent.phase !== "login_required" && <Button onClick={() => void agent.start()}>{agent.phase === "expired" ? "새 번호로 연결" : "다시 연결"}</Button>}
      {agent.phase === "login_required" && <Link href="/" className="inline-flex min-h-10 items-center justify-center rounded-sm bg-accent px-3 text-[13px] font-medium text-accent-fg">로그인하러 가기</Link>}
      {pending && <Button variant="ghost" onClick={() => void agent.cancel()}>연결 취소</Button>}
    </>}
    {agent.message && <p role="alert" className="text-[12px] leading-relaxed text-busy">{agent.message}</p>}
  </ConnectionDialog>;
}
