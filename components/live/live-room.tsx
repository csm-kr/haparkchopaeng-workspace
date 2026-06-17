"use client";

import * as React from "react";
import { LiveKitRoom } from "@livekit/components-react";
import { Video } from "lucide-react";
import { useLive } from "@/components/providers";
import { Button, Card, EmptyState } from "@/components/ui";
import { MeetHeader } from "./meet-header";
import { MeetRoom } from "./meet-room";
import type { LiveMember, SharablePresentation } from "./types";

// 세미나 라이브 룸 — LiveKit 다자간 화상(ADR-019, ADR-002 대체). 'use client' 인터랙티브 섬(R32).
// CRITICAL: `live`는 화면 state로 보관하지 않는다 — 앱 레벨 useLive()가 단일 소스(ADR-001/R5).
// CRITICAL: 접속 토큰은 라우트(/start·/join)에서만 받는다 — 클라가 DB/LiveKit 서버 키를 직접 보지 않는다(R2/R32).
// CRITICAL: 종료(/end)만 전역 종료(파괴적, 확인) — 나가기(/leave)는 본인만(ADR-001/R6·R27).
// 영상/타일/생명주기는 MeetRoom(룸 컨텍스트), 타이머/LIVE는 MeetHeader(컨텍스트 밖)로 분리.

/** live-room 멤버 표시 타입 — 공용 LiveMember와 동형(하위 호환 유지). */
export type LiveRoomMember = LiveMember;

export interface LiveRoomSession {
  id: string;
  presenterId: string;
  /** 서버 LiveSession.startedAt(ISO) — 송출 타이머 기준. 없으면 00:00부터. */
  startedAt?: string;
  /** 현재 접속 중(leftAt=null)인 멤버 id. */
  participantIds: string[];
}

export interface LiveRoomProps {
  currentMemberId: string;
  /** 서버(RSC)에서 주입한 첫 렌더 스냅샷(ADR-015). 없으면 라이브 없음. */
  initialSession: LiveRoomSession | null;
  members: LiveRoomMember[];
  /** 공유 가능한 발표자료(PDF 자산 보유, 활성 팀). 발표자가 무대에 띄울 수 있다. */
  shareablePresentations: SharablePresentation[];
}

/** 라우트가 준 LiveKit 접속 정보(참가자별·단기). */
interface Connection {
  token: string;
  url: string;
}

/** 시작 시 에러 분기. */
type StartError = "conflict" | "error" | null;

export function LiveRoom({
  currentMemberId,
  initialSession,
  members,
  shareablePresentations,
}: LiveRoomProps) {
  const { live, setLive } = useLive();

  const [session, setSession] = React.useState<LiveRoomSession | null>(
    initialSession,
  );
  const [connection, setConnection] = React.useState<Connection | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [roomError, setRoomError] = React.useState(false);
  const [reconnect, setReconnect] = React.useState(0);

  const [starting, setStarting] = React.useState(false);
  const [startError, setStartError] = React.useState<StartError>(null);
  // 서버가 준 친절한 사유(예: 송출 미설정 503)를 그대로 보여준다(R30).
  const [startErrorMsg, setStartErrorMsg] = React.useState<string | null>(null);
  const [joinError, setJoinError] = React.useState(false);
  const [confirmEnd, setConfirmEnd] = React.useState(false);
  const [ending, setEnding] = React.useState(false);
  const [endError, setEndError] = React.useState(false);
  const [left, setLeft] = React.useState(false);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  // 발표자 이탈 시 /end를 단일 언로드에서 1회만 보내기 위한 가드(pagehide+beforeunload 중복 방지).
  const endSentRef = React.useRef(false);

  const isPresenter = !!session && session.presenterId === currentMemberId;

  const handleConnected = React.useCallback(() => setConnected(true), []);
  const handleRoomError = React.useCallback(() => setRoomError(true), []);

  // 전이 반영: live가 켜졌는데(다른 사람이 시작) 로컬 세션 정보가 없으면 서버에서 보강.
  React.useEffect(() => {
    if (!live || session) return;
    let cancelled = false;
    fetch("/api/live")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.data) return;
        setSession({
          id: j.data.id,
          presenterId: j.data.presenterId,
          startedAt: j.data.startedAt,
          participantIds: (j.data.participants ?? [])
            .filter((p: { leftAt: string | null }) => !p.leftAt)
            .map((p: { memberId: string }) => p.memberId),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live, session]);

  // 시청자: 룸에 들어오면 join → LiveKit 토큰 수신(발표자는 시작 시 받았으므로 join 안 함).
  React.useEffect(() => {
    if (!live || !session || isPresenter || left || connection || joinError)
      return;
    let cancelled = false;
    fetch(`/api/live/${session.id}/join`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        if (j?.data?.token && j?.data?.url) {
          setConnected(false);
          setRoomError(false);
          setConnection({ token: j.data.token, url: j.data.url });
        } else {
          setJoinError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setJoinError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [live, session, isPresenter, left, connection, joinError]);

  // 발표자 이탈 시 자동 종료(ADR-001/R6): 풀 언로드(pagehide/beforeunload)에서 /end 비콘 전송.
  // 탭/창 닫기·새로고침·외부 이동을 잡는다 — 크래시·네트워크 끊김·SPA 내부 이동은 미보장(best-effort).
  // 본인이 발표자일 때만. sendBeacon은 같은 출처 쿠키를 포함해 /end의 requireAuth가 그대로 동작한다.
  React.useEffect(() => {
    if (!live || !session || !isPresenter) return;
    const endOnUnload = () => {
      if (endSentRef.current) return;
      endSentRef.current = true;
      const url = `/api/live/${session.id}/end`;
      if (navigator.sendBeacon) navigator.sendBeacon(url);
      else void fetch(url, { method: "POST", keepalive: true });
    };
    window.addEventListener("pagehide", endOnUnload);
    window.addEventListener("beforeunload", endOnUnload);
    return () => {
      window.removeEventListener("pagehide", endOnUnload);
      window.removeEventListener("beforeunload", endOnUnload);
    };
  }, [live, session, isPresenter]);

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    setStartErrorMsg(null);
    try {
      const r = await fetch("/api/live/start", { method: "POST" });
      if (r.status === 409) {
        setStartError("conflict");
        return;
      }
      if (!r.ok) {
        // 서버의 친절한 사유(503 송출 미설정 등)를 그대로 노출(R30).
        const body = (await r.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setStartErrorMsg(body?.error?.message ?? null);
        setStartError("error");
        return;
      }
      const j = await r.json();
      setSession({
        id: j.data.session.id,
        presenterId: j.data.session.presenterId,
        startedAt: j.data.session.startedAt,
        participantIds: [j.data.session.presenterId],
      });
      setConnected(false);
      setRoomError(false);
      setConnection({ token: j.data.token, url: j.data.url });
      setLive(true); // 낙관적 — Realtime이 확정(R33)
    } catch {
      setStartError("error");
    } finally {
      setStarting(false);
    }
  }

  // 409로 안내된 입장: 이미 active 세션이 있으니 live를 켜고 보강 effect가 세션을 채운다.
  function handleEnter() {
    setStartError(null);
    setLeft(false);
    setLive(true);
  }

  async function handleEnd() {
    if (!session) return;
    setEnding(true);
    setEndError(false);
    try {
      const r = await fetch(`/api/live/${session.id}/end`, { method: "POST" });
      if (!r.ok) {
        setEndError(true);
        return;
      }
      setConfirmEnd(false);
      setSession(null);
      setConnection(null);
      setConnected(false);
      setLive(false); // 낙관적 — Realtime이 확정
    } catch {
      setEndError(true);
    } finally {
      setEnding(false);
    }
  }

  // 나가기: 본인만 퇴장. 전역 live는 유지(전역 종료 아님, R6). LiveKit 룸은 연결 해제(언마운트).
  async function handleLeave() {
    if (!session) return;
    setLeft(true);
    setConnection(null);
    setConnected(false);
    try {
      await fetch(`/api/live/${session.id}/leave`, { method: "POST" });
    } catch {
      // best-effort — 화면은 이미 퇴장 상태로 전환
    }
  }

  function handleReenter() {
    setLeft(false); // join effect가 다시 토큰을 받아온다
  }

  function handleRetry() {
    setRoomError(false);
    setConnected(false);
    setReconnect((n) => n + 1); // LiveKitRoom 강제 재마운트
  }

  // ── 라이브 없음 (기본) ───────────────────────────────────────────────
  if (!live) {
    if (startError === "conflict") {
      // 동시 시작은 사고가 아니라 합류로 안내(R30).
      return (
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-[15px] font-semibold text-fg">
            이미 라이브가 진행 중이에요 — 입장할까요?
          </p>
          <p className="max-w-sm text-[13px] text-fg-muted">
            다른 멤버가 먼저 세미나를 시작했어요.
          </p>
          <Button onClick={handleEnter}>입장</Button>
        </Card>
      );
    }
    return (
      <EmptyState
        icon={<Video size={20} />}
        title="아직 진행 중인 세미나가 없어요"
        description="라이브를 시작하면 모두에게 알림이 가고 바로 룸이 열려요."
        action={
          <div className="flex flex-col items-center gap-2">
            <Button onClick={handleStart} disabled={starting}>
              {starting ? "여는 중…" : "라이브 시작"}
            </Button>
            {startError === "error" && (
              <p className="text-[12px] text-busy">
                {startErrorMsg ??
                  "지금은 시작할 수 없어요. 잠깐 후 다시 시도해주세요."}
              </p>
            )}
          </div>
        }
      />
    );
  }

  // ── 라이브 중인데 로컬 세션 정보 보강 전 ────────────────────────────
  if (!session) {
    return <ConnectingCard />;
  }

  const presenter = members.find((m) => m.id === session.presenterId);

  // 본문: 발표자 새로고침(토큰 유실) / 나감 / 접속 대기 / 룸.
  let body: React.ReactNode;
  if (isPresenter && !connection) {
    // 발표자 화면 자격증명은 시작 시 1회만 받는다 — 새로고침 등으로 유실되면 재시작 안내(graceful, R30).
    body = (
      <Card className="grid place-items-center px-6 py-12 text-center">
        <p className="max-w-sm text-[13px] text-fg-muted">
          발표 화면을 다시 불러오려면 종료 후 다시 시작해주세요.
        </p>
      </Card>
    );
  } else if (left) {
    body = (
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-[13px] text-fg-muted">라이브에서 나왔어요.</p>
        <Button onClick={handleReenter}>다시 입장</Button>
      </Card>
    );
  } else if (!connection) {
    body = joinError ? (
      <RoomErrorCard onRetry={() => setJoinError(false)} />
    ) : (
      <ConnectingCard />
    );
  } else {
    body = (
      <LiveKitRoom
        key={reconnect}
        serverUrl={connection.url}
        token={connection.token}
        connect
        audio={false}
        video={false}
        screen={false}
        onConnected={handleConnected}
        onError={handleRoomError}
        className="flex flex-col gap-3"
      >
        {roomError ? (
          <RoomErrorCard onRetry={handleRetry} />
        ) : !connected ? (
          <ConnectingCard />
        ) : (
          <MeetRoom
            members={members}
            presenterId={session.presenterId}
            currentMemberId={currentMemberId}
            isPresenter={isPresenter}
            presentations={shareablePresentations}
          />
        )}
      </LiveKitRoom>
    );
  }

  const action = isPresenter ? (
    <Button variant="danger" onClick={() => setConfirmEnd(true)}>
      라이브 종료
    </Button>
  ) : left ? null : (
    <Button variant="secondary" onClick={() => setConfirmLeave(true)}>
      나가기
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 룸 헤더: LIVE 표시(색+텍스트 병행, R29) + 송출 타이머 + 본인 역할 액션 */}
      <MeetHeader
        startedAt={session.startedAt}
        presenterName={presenter?.name}
        action={action}
      />

      {body}

      {endError && (
        <p className="text-[12px] text-busy">
          종료하지 못했어요. 잠깐 후 다시 시도해주세요.
        </p>
      )}

      {/* 종료 확인 — 파괴적 액션은 확인을 거친다(R27) */}
      {confirmEnd && (
        <ConfirmDialog
          title="라이브를 종료할까요?"
          body="모두의 세션이 끝나요. 다시 시작하려면 새로 열어야 해요."
          confirmLabel="종료할게요"
          busyLabel="종료 중…"
          variant="danger"
          busy={ending}
          onCancel={() => setConfirmEnd(false)}
          onConfirm={handleEnd}
        />
      )}

      {/* 나가기 확인 — 비파괴적이지만 실수 방지. 본인만 퇴장(R6) */}
      {confirmLeave && (
        <ConfirmDialog
          title="라이브에서 나갈까요?"
          body="언제든 다시 입장할 수 있어요."
          confirmLabel="나갈게요"
          variant="primary"
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            handleLeave();
          }}
        />
      )}
    </div>
  );
}

/** 접속 대기(로딩) — 상태 3종의 로딩(R26). */
function ConnectingCard() {
  return (
    <Card
      role="status"
      className="grid place-items-center px-6 py-12 text-center"
    >
      <p className="text-[13px] text-fg-muted">연결 중이에요…</p>
    </Card>
  );
}

/** 접속 실패(에러) — 다시 시도(R26/R30). 화면을 통째로 날리지 않는다. */
function RoomErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-[13px] text-fg-muted">
        룸에 연결하지 못했어요. 잠깐 후 다시 시도해주세요.
      </p>
      <Button variant="secondary" onClick={onRetry}>
        다시 시도
      </Button>
    </Card>
  );
}

/**
 * 확인 다이얼로그 — 종료(파괴적, R27)·나가기(비파괴적) 공용. 포커스 트랩까지는 다음 단계.
 * variant로 확인 버튼 강조를 가른다(danger=파괴적, primary=일반).
 */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busyLabel,
  variant = "danger",
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busyLabel?: string;
  variant?: "danger" | "primary";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--fg)_40%,transparent)] p-4"
      onClick={onCancel}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-full max-w-sm flex-col gap-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-fg">{title}</p>
          <p className="text-[13px] text-fg-muted">{body}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={busy}>
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
