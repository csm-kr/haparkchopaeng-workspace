"use client";

import * as React from "react";
import Link from "next/link";
import {
  useDataChannel,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { FileText, Radio, X } from "lucide-react";
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
import type { ActiveAnnotation, DrawInput } from "./annotation-overlay";
import type {
  ChatEntry,
  FloatingReaction,
  LiveMember,
  PresentState,
  SharablePresentation,
} from "./types";

// MeetRoom — LiveKit 룸 컨텍스트 안의 Google Meet 스타일 셸.
// 채팅·반응·손들기는 별도 서버 없이 LiveKit 데이터 채널로만 주고받는다(휘발·미저장, ADR-019).
// CRITICAL: 작성자는 LiveKit identity로 판별한다 — 페이로드 author 미신뢰(R3).
// CRITICAL: decodeLiveMessage가 null이면(형식 위반) 무시한다(방어적).
// CRITICAL: 화면공유·발표자료 공유는 발표자만(isPresenter → canScreenShare/canPresent, R7).
// CRITICAL: 발표 상태(present)는 발표자 identity가 보낸 것만 신뢰한다(R3) — 시청자 위조 무시.

const DATA_TOPIC = "live";

export interface MeetRoomProps {
  members: LiveMember[];
  presenterId: string;
  currentMemberId: string;
  isPresenter: boolean;
  /** 공유 가능한 발표자료(PDF 자산 보유) — 발표자가 무대에 띄울 수 있다(RSC 주입). */
  presentations: SharablePresentation[];
}

type PanelTab = "chat" | "people" | "files";

export function MeetRoom({
  members,
  presenterId,
  currentMemberId,
  isPresenter,
  presentations,
}: MeetRoomProps) {
  const room = useRoomContext();
  const participants = useParticipants();

  const [panel, setPanel] = React.useState<PanelTab | null>(null);
  // 내 얼굴 숨기기 — 내 화면에서만 내 타일을 감춘다(로컬 전용, 데이터 채널 전파 없음).
  const [hideSelf, setHideSelf] = React.useState(false);
  const [chat, setChat] = React.useState<ChatEntry[]>([]);
  const [floats, setFloats] = React.useState<FloatingReaction[]>([]);
  const [hands, setHands] = React.useState<Set<string>>(new Set());
  const [annots, setAnnots] = React.useState<ActiveAnnotation[]>([]);
  // 발표자료 공유 상태(휘발) — 데이터 채널로 동기화. presentRef는 콜백/effect의 stale 클로저 방지.
  const [present, setPresent] = React.useState<PresentState | null>(null);
  const presentRef = React.useRef<PresentState | null>(null);
  React.useEffect(() => {
    presentRef.current = present;
  }, [present]);

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

  // 화면공유 주석(펜/레이저) — 받는 즉시 추가하고 수명(펜 3초·레이저 1.2초) 뒤 제거(반응과 동일 패턴).
  const addAnnot = React.useCallback((a: DrawInput) => {
    const id = `${Date.now()}-${Math.random()}`;
    setAnnots((prev) => [
      ...prev,
      { id, tool: a.tool, color: a.color, points: a.points },
    ]);
    const life = a.tool === "laser" ? 1200 : 3000;
    setTimeout(() => setAnnots((prev) => prev.filter((x) => x.id !== id)), life);
  }, []);

  // 발표 상태 반영 — 자료/페이지가 실제로 바뀔 때만 잔여 주석을 비운다(휘발 주석이라 안전).
  // 늦은 입장 재전송처럼 같은 페이지를 다시 받을 땐 비우지 않는다(불필요한 깜빡임 방지).
  const applyPresent = React.useCallback(
    (p: { presentationId: string | null; page: number; pageCount: number }) => {
      const cur = presentRef.current;
      const changed =
        !cur || p.presentationId !== cur.presentationId || p.page !== cur.page;
      if (changed) setAnnots([]);
      setPresent(
        p.presentationId === null
          ? null
          : { presentationId: p.presentationId, page: p.page, pageCount: p.pageCount },
      );
    },
    [],
  );

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
      } else if (m.kind === "hand") {
        setHand(identity, m.up);
      } else if (m.kind === "annot") {
        addAnnot(m);
      } else if (m.kind === "present") {
        // 발표 상태는 발표자만 신뢰(R3) — 시청자가 위조해도 무대가 바뀌지 않는다.
        if (identity === presenterId) applyPresent(m);
      }
    },
    [addFloat, setHand, addAnnot, applyPresent, presenterId],
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

  // 발표자 그리기 → 데이터 채널 전파 + 낙관적 로컬 표시(publishData는 본인에게 echo 안 됨).
  const sendAnnot = React.useCallback(
    (a: DrawInput) => {
      publish({
        kind: "annot",
        tool: a.tool,
        color: a.color,
        points: a.points,
        at: Date.now(),
      });
      addAnnot(a);
    },
    [publish, addAnnot],
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

  // 발표자: 자료 공유 시작 — 페이지 수를 받아 1쪽부터 전파(낙관적 로컬 반영). 실패는 조용히 무시(graceful).
  const startPresent = React.useCallback(
    async (presentationId: string) => {
      try {
        const res = await fetch(`/api/presentations/${presentationId}/pages`);
        const json = (await res.json().catch(() => null)) as
          | { data?: { count?: number } }
          | null;
        const count = json?.data?.count;
        if (!res.ok || typeof count !== "number" || count < 1) return;
        publish({ kind: "present", presentationId, page: 1, pageCount: count, at: Date.now() });
        applyPresent({ presentationId, page: 1, pageCount: count });
        setPanel(null); // 공유를 켜면 패널을 닫아 무대를 크게
      } catch {
        // 네트워크 실패 — 무대 변화 없음(graceful, R30)
      }
    },
    [publish, applyPresent],
  );

  // 발표자: 페이지 이동 — [1, pageCount] 클램프 후 전파.
  const changePage = React.useCallback(
    (page: number) => {
      const cur = presentRef.current;
      if (!cur) return;
      const p = Math.min(Math.max(1, page), cur.pageCount);
      publish({
        kind: "present",
        presentationId: cur.presentationId,
        page: p,
        pageCount: cur.pageCount,
        at: Date.now(),
      });
      applyPresent({ presentationId: cur.presentationId, page: p, pageCount: cur.pageCount });
    },
    [publish, applyPresent],
  );

  // 발표자: 공유 중지 — presentationId:null 전파.
  const stopPresent = React.useCallback(() => {
    publish({ kind: "present", presentationId: null, page: 1, pageCount: 1, at: Date.now() });
    applyPresent({ presentationId: null, page: 1, pageCount: 1 });
  }, [publish, applyPresent]);

  // 늦은 입장 동기화: 참가자가 늘면(새로 입장) 발표자가 현재 발표 상태를 재전송한다.
  // 데이터 채널은 과거 메시지를 재생하지 않으므로, 새 참가자에게 현재 페이지를 다시 알린다(ADR-019).
  const prevParticipantCount = React.useRef(participants.length);
  React.useEffect(() => {
    const cur = presentRef.current;
    if (isPresenter && cur && participants.length > prevParticipantCount.current) {
      publish({
        kind: "present",
        presentationId: cur.presentationId,
        page: cur.page,
        pageCount: cur.pageCount,
        at: Date.now(),
      });
    }
    prevParticipantCount.current = participants.length;
  }, [participants.length, isPresenter, publish]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="relative min-w-0 flex-1">
          <RoomStage
            members={members}
            presenterId={presenterId}
            currentMemberId={currentMemberId}
            hands={hands}
            annotations={annots}
            onDraw={isPresenter ? sendAnnot : undefined}
            present={present}
            onChangePage={isPresenter ? changePage : undefined}
            hideSelf={hideSelf}
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
              {panel === "files" && (
                <PresentationsPanel
                  presentations={presentations}
                  currentPresentationId={present?.presentationId ?? null}
                  isPresenter={isPresenter}
                  onShare={startPresent}
                  onStop={stopPresent}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      <MeetControls
        canScreenShare={isPresenter}
        canPresent={isPresenter}
        presenting={!!present}
        handUp={handUpSelf}
        panelOpen={panel !== null}
        onToggleHand={toggleHand}
        onReact={react}
        onTogglePanel={() => setPanel((p) => (p ? null : "chat"))}
        onOpenPresent={() => setPanel("files")}
        onStopPresent={stopPresent}
        hideSelf={hideSelf}
        onToggleHideSelf={() => setHideSelf((v) => !v)}
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

// 자료 패널 — 공유 가능한 발표자료(PDF) 목록. 발표자는 무대에 띄우거나(공유) 내릴 수 있고(중지),
// 시청자는 현재 무엇이 발표 중인지 본다. 공유할 자료가 없으면 발표 자료 목록으로 안내(R26/R30).
function PresentationsPanel({
  presentations,
  currentPresentationId,
  isPresenter,
  onShare,
  onStop,
}: {
  presentations: SharablePresentation[];
  currentPresentationId: string | null;
  isPresenter: boolean;
  onShare: (id: string) => void;
  onStop: () => void;
}) {
  if (presentations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-[12px] text-fg-subtle">
          공유할 수 있는 PDF 발표자료가 아직 없어요.
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

  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
      {presentations.map((p) => {
        const active = p.id === currentPresentationId;
        return (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-hover"
          >
            <FileText
              size={15}
              aria-hidden="true"
              className="shrink-0 text-fg-subtle"
            />
            <span className="min-w-0 flex-1 truncate text-[12px] text-fg">
              {p.title}
            </span>
            {active && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[10px] bg-busy px-1.5 py-0.5 text-[10px] font-semibold text-accent-fg">
                <Radio size={10} aria-hidden="true" />
                발표 중
              </span>
            )}
            {isPresenter &&
              (active ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="shrink-0 rounded-sm border border-border-strong px-2 py-0.5 text-[11px] font-medium text-fg hover:bg-bg-hover"
                >
                  중지
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onShare(p.id)}
                  className="shrink-0 rounded-sm bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent-soft/80"
                >
                  공유
                </button>
              ))}
          </li>
        );
      })}
    </ul>
  );
}
