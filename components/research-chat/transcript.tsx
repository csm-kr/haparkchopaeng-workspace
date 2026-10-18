"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import type { ResearchConversationDetail } from "@/types/research-chat";
import { ResponseContent } from "./response-content";

export function Transcript({ detail, onRetry, children }: { detail: ResearchConversationDetail | null; onRetry: (prompt: string) => void; children: React.ReactNode }) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const following = React.useRef(true);
  const [unread, setUnread] = React.useState(false);
  const tail = detail?.turns.at(-1);
  React.useLayoutEffect(() => {
    if (following.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    else if (tail?.response) setUnread(true);
  }, [tail?.response, tail?.status]);
  React.useEffect(() => { following.current = true; setUnread(false); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [detail?.conversation.id]);
  return <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scroller} role="log" aria-label="연구 대화 내용" aria-live="off" className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
      onScroll={(event) => { const node = event.currentTarget; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; if (following.current) setUnread(false); }}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {detail?.hasEarlierTurns && <p className="rounded-md bg-bg-subtle p-3 text-[12px] text-fg-muted">최근 질문 50개를 보여 드려요. 이전 대화 일부는 화면과 다음 답변의 맥락에서 제외될 수 있어요.</p>}
        {detail?.turns.map((turn) => <article key={turn.id} aria-label={`질문 ${turn.conversationTurn}`} className="flex min-w-0 flex-col gap-3">
          <div className="ml-auto max-w-full rounded-lg bg-bg-subtle px-4 py-3">
            {!!turn.materials?.length && <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">{turn.materials.map(item => <Link key={`${item.kind}:${item.id}`} href={`/${item.kind === "paper" ? "papers" : "presentations"}/${encodeURIComponent(item.id)}`} className="max-w-full truncate text-[11px] text-fg-muted hover:text-accent">@{item.title}</Link>)}</div>}
            <p className="whitespace-pre-wrap break-words text-[14px] text-fg">{turn.prompt}</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-fg-muted"><span>{turn.provider === "codex" ? "Codex" : "Claude Code"}</span><span aria-hidden="true">·</span><span className="break-all font-mono">{turn.model}</span></div>
          {turn.response && <ResponseContent text={turn.response} />}
          <p role="status" className={`text-[12px] ${turn.status === "failed" ? "text-busy" : "text-fg-muted"}`}>{turn.status === "preparing" ? "첨부 자료를 읽고 있어요…" : turn.status === "queued" ? "답변을 준비하고 있어요…" : turn.status === "running" ? "답변 중…" : turn.status === "completed" ? "" : turn.status === "cancelled" ? turn.error?.trim() || "답변을 중지했어요." : turn.error?.trim() || "답변을 완료하지 못했어요. 다시 시도해 주세요."}</p>
          {turn.contextTruncated && <p className="text-[11px] leading-relaxed text-fg-muted">분량 제한으로 자료 본문 또는 이전 대화 일부를 제외했어요.</p>}
          {(turn.status === "failed" || turn.status === "cancelled") && <Button variant="ghost" size="sm" className="min-h-10 self-start" onClick={() => onRetry(turn.prompt)}>질문 다시 쓰기</Button>}
        </article>)}
        {!detail?.turns.length && children}
      </div>
    </div>
    {unread && <Button variant="secondary" size="sm" className="absolute bottom-3 left-1/2 min-h-10 -translate-x-1/2 shadow-[var(--shadow-sm)]" onClick={() => { following.current = true; setUnread(false); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }}>새 답변 보기</Button>}
  </div>;
}
