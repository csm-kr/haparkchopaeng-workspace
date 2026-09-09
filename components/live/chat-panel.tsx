"use client";

import * as React from "react";
import { ImagePlus, Send } from "lucide-react";
import { Avatar, Input } from "@/components/ui";
import {
  MAX_IMAGE_BYTES,
  validateImageFile,
  type ImageRejectReason,
} from "@/lib/live-image";
import type { ChatEntry, LiveMember } from "./types";

// 휘발 채팅 패널(내용만 — 헤더/탭은 MeetRoom이 제공).
// 데이터 채널 메시지를 시간순 표시(미저장, 새로고침 시 비어도 정상, R21).
// CRITICAL: 작성자는 LiveKit identity로 판별해 members에서 매핑한다 — 페이로드 author 미신뢰(R3).
// CRITICAL: 이미지도 저장하지 않는다 — 룸 참가자에게 직접 보낸 바이트를 blob URL로 그린다(R21).
//   보내기 전에 형식·크기를 검증한다. 못 보낼 파일은 상대 대역폭을 쓰지 않는다.

const MAX_IMAGE_MB = Math.round(MAX_IMAGE_BYTES / 1024 / 1024);

/** 거절 사유별 안내 — 정체불명 실패 대신 사람 말로(R30). */
const REJECT_MESSAGE: Record<ImageRejectReason, string> = {
  type: "이미지 파일만 보낼 수 있어요.",
  size: `이미지가 너무 커요. ${MAX_IMAGE_MB}MB 이하로 보내주세요.`,
};

export interface ChatPanelProps {
  messages: ChatEntry[];
  members: LiveMember[];
  onSend: (text: string) => void;
  /** 검증을 통과한 이미지 파일. 실제 전송은 상위(MeetRoom)가 한다. */
  onSendImage: (file: File) => void;
}

export function ChatPanel({ messages, members, onSend, onSendImage }: ChatPanelProps) {
  const [draft, setDraft] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  function send() {
    const text = draft.trim();
    if (!text) return; // 빈 값은 보내지 않는다(인라인 검증, R30)
    onSend(text);
    setDraft("");
  }

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 고를 수 있게 값을 비운다(change가 다시 발생하도록).
    e.target.value = "";
    if (!file) return;

    const reason = validateImageFile(file);
    if (reason) {
      setNotice(REJECT_MESSAGE[reason]);
      return;
    }
    setNotice(null);
    onSendImage(file);
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
                  {m.imageUrl && (
                    // blob URL이라 next/image로 최적화할 대상이 아니다(룸 안에서만 유효).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.imageUrl}
                      alt={`${user.name} 님이 보낸 이미지`}
                      className="mt-1 max-h-48 w-auto rounded-sm border border-border-token object-contain"
                    />
                  )}
                  {m.text && (
                    <p className="text-[13px] break-words text-fg-muted">{m.text}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {notice && (
        <p className="border-t border-border-token px-3 py-1.5 text-[11px] text-busy">
          {notice}
        </p>
      )}

      <div className="flex items-center gap-1 border-t border-border-token p-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          aria-label="이미지 첨부"
          className="hidden"
          onChange={pickImage}
        />
        <button
          type="button"
          aria-label="이미지 보내기"
          onClick={() => fileRef.current?.click()}
          className="grid size-9 shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-bg-hover hover:text-fg"
        >
          <ImagePlus size={16} aria-hidden="true" />
        </button>
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
