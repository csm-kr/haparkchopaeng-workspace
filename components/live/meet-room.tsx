"use client";

import * as React from "react";
import Link from "next/link";
import {
  useDataChannel,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { X } from "lucide-react";
import {
  decodeLiveMessage,
  encodeLiveMessage,
  type LiveMessage,
} from "@/lib/live-messages";
import { ChatPanel } from "./chat-panel";
import { MeetControls } from "./meet-controls";
import { PeoplePanel } from "./people-panel";
import { ReactionsLayer } from "./reactions-layer";
import { RoomStage } from "./room-stage";
import type { ChatEntry, FloatingReaction, LiveMember } from "./types";

// MeetRoom — LiveKit 룸 컨텍스트 안의 Google Meet 스타일 셸.
// 채팅·반응·손들기는 별도 서버 없이 LiveKit 데이터 채널로만 주고받는다(휘발·미저장, ADR-019).
// CRITICAL: 작성자는 LiveKit identity로 판별한다 — 페이로드 author 미신뢰(R3).
// CRITICAL: decodeLiveMessage가 null이면(형식 위반) 무시한다(방어적).
// CRITICAL: 화면공유는 발표자만(isPresenter → canScreenShare, R7).

const DATA_TOPIC = "live";

export interface MeetRoomProps {
  members: LiveMember[];
  presenterId: string;
  currentMemberId: string;
  isPresenter: boolean;
}

type PanelTab = "chat" | "people" | "files";

export function MeetRoom({
  members,
  presenterId,
  currentMemberId,
  isPresenter,
}: MeetRoomProps) {
  const room = useRoomContext();
  const participants = useParticipants();

  const [panel, setPanel] = React.useState<PanelTab | null>(null);
  const [chat, setChat] = React.useState<ChatEntry[]>([]);
  const [floats, setFloats] = React.useState<FloatingReaction[]>([]);
  const [hands, setHands] = React.useState<Set<string>>(new Set());

  const addFloat = React.useCallback((emoji: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    const left = 12 + Math.random() * 72;
    setFloats((f) => [...f, { id, emoji, left }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 2400);
  }, []);

  const setHand = React.useCallback((identity: string, up: boolean) => {
    setHands((prev) => {
      const next = new Set(prev);
      if (up) next.add(identity);
      else next.delete(identity);
      return next;
    });
  }, []);

  // 수신: 작성자는 identity로 판별(R3), 형식 위반은 무시.
  const onMessage = React.useCallback(
    (msg: { payload: Uint8Array; from?: { identity?: string } }) => {
      const m = decodeLiveMessage(msg.payload);
      if (!m) return;
      const identity = msg.from?.identity ?? "unknown";
      if (m.kind === "chat") {
        setChat((c) => [
          ...c,
          { id: `${identity}-${m.at}-${c.length}`, identity, text: m.text, at: m.at },
        ]);
      } else if (m.kind === "reaction") {
        addFloat(m.emoji);
      } else {
        setHand(identity, m.up);
      }
    },
    [addFloat, setHand],
  );

  useDataChannel(DATA_TOPIC, onMessage);

  // 송신: 데이터 채널로 직접 publish(별도 API/Supabase 채널 없음, ADR-019).
  const publish = React.useCallback(
    (m: LiveMessage) => {
      room?.localParticipant?.publishData(encodeLiveMessage(m), {
        reliable: true,
        topic: DATA_TOPIC,
      });
    },
    [room],
  );

  function sendChat(text: string) {
    const at = Date.now();
    publish({ kind: "chat", text, at });
    // 낙관적 — publishData는 본인에게 echo되지 않는다.
    setChat((c) => [
      ...c,
      { id: `me-${at}-${c.length}`, identity: currentMemberId, text, at },
    ]);
  }

  function react(emoji: string) {
    publish({ kind: "reaction", emoji, at: Date.now() });
    addFloat(emoji);
  }

  const handUpSelf = hands.has(currentMemberId);
  function toggleHand() {
    const up = !handUpSelf;
    publish({ kind: "hand", up, at: Date.now() });
    setHand(currentMemberId, up);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="relative min-w-0 flex-1">
          <RoomStage
            members={members}
            presenterId={presenterId}
            currentMemberId={currentMemberId}
            hands={hands}
          />
          <ReactionsLayer reactions={floats} />
        </div>

        {panel && (
          <aside className="flex w-72 shrink-0 flex-col rounded-lg border border-border-token bg-bg-elevated">
            <div className="flex items-center justify-between border-b border-border-token px-2 py-1.5">
              <div className="flex items-center gap-1">
                <PanelTabButton
                  active={panel === "chat"}
                  onClick={() => setPanel("chat")}
                >
                  채팅
                </PanelTabButton>
                <PanelTabButton
                  active={panel === "people"}
                  onClick={() => setPanel("people")}
                >
                  참가자 {participants.length}
                </PanelTabButton>
                <PanelTabButton
                  active={panel === "files"}
                  onClick={() => setPanel("files")}
                >
                  자료
                </PanelTabButton>
              </div>
              <button
                type="button"
                aria-label="패널 닫기"
                onClick={() => setPanel(null)}
                className="grid size-7 place-items-center rounded-sm text-fg-subtle hover:bg-bg-hover hover:text-fg"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col" style={{ height: 320 }}>
              {panel === "chat" && (
                <ChatPanel messages={chat} members={members} onSend={sendChat} />
              )}
              {panel === "people" && (
                <PeoplePanel
                  members={members}
                  presenterId={presenterId}
                  currentMemberId={currentMemberId}
                  hands={hands}
                />
              )}
              {panel === "files" && <FilesPanel />}
            </div>
          </aside>
        )}
      </div>

      <MeetControls
        canScreenShare={isPresenter}
        handUp={handUpSelf}
        panelOpen={panel !== null}
        onToggleHand={toggleHand}
        onReact={react}
        onTogglePanel={() => setPanel((p) => (p ? null : "chat"))}
      />
    </div>
  );
}

function PanelTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? "rounded-sm bg-accent-soft px-2 py-1 text-[12px] font-semibold text-accent"
          : "rounded-sm px-2 py-1 text-[12px] font-medium text-fg-muted hover:bg-bg-hover hover:text-fg"
      }
    >
      {children}
    </button>
  );
}

// 자료 패널 — 세션↔발표자료 연결이 스키마에 없으므로 가짜 데이터를 만들지 않는다(R21).
// 정직하게 발표 자료 목록으로 가는 링크 하나만 둔다(세션별 연결은 미결, ISSUES).
function FilesPanel() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-[12px] text-fg-subtle">
        이 세미나에 연결된 자료는 아직 없어요.
      </p>
      <Link
        href="/presentations"
        className="rounded-sm border border-border-strong px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-bg-hover"
      >
        발표 자료 보러 가기
      </Link>
    </div>
  );
}
