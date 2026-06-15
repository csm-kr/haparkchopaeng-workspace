"use client";

import * as React from "react";
import { Send } from "lucide-react";
import { Avatar, Input } from "@/components/ui";
import type { ChatEntry, LiveMember } from "./types";

// 휘발 채팅 패널(내용만 — 헤더/탭은 MeetRoom이 제공).
// 데이터 채널 메시지를 시간순 표시(미저장, 새로고침 시 비어도 정상, R21).
// CRITICAL: 작성자는 LiveKit identity로 판별해 members에서 매핑한다 — 페이로드 author 미신뢰(R3).

export interface ChatPanelProps {
  messages: ChatEntry[];
  members: LiveMember[];
  onSend: (text: string) => void;
}

export function ChatPanel({ messages, members, onSend }: ChatPanelProps) {
  const [draft, setDraft] = React.useState("");

  function send() {
    const text = draft.trim();
    if (!text) return; // 빈 값은 보내지 않는다(인라인 검증, R30)
    onSend(text);
    setDraft("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="m-auto max-w-[16rem] text-center text-[12px] text-fg-subtle">
            아직 채팅이 없어요. 먼저 인사를 건네볼까요?
          </p>
        ) : (
          messages.map((m) => {
            const member = members.find((x) => x.id === m.identity);
            const user = member ?? {
              name: m.identity,
              initial: m.identity.slice(0, 1).toUpperCase(),
              color: "var(--fg-faint)",
            };
            return (
              <div key={m.id} className="flex items-start gap-2">
                <Avatar user={user} size="sm" className="mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-fg">{user.name}</p>
                  <p className="text-[13px] break-words text-fg-muted">{m.text}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border-token p-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 한글/일본어 등 IME 조합 중 Enter는 조합 확정용 — 전송하지 않는다.
            // (조합 중 전송하면 "대박" + 남은 조합 "박"으로 쪼개진다.)
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="모두에게 메시지…"
          aria-label="채팅 메시지"
        />
        <button
          type="button"
          aria-label="보내기"
          onClick={send}
          className="grid size-9 shrink-0 place-items-center rounded-sm text-accent hover:bg-bg-hover disabled:opacity-40"
          disabled={draft.trim().length === 0}
        >
          <Send size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
