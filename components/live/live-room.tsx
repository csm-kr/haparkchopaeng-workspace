"use client";

import * as React from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useParticipants,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Mic, Radio, Video } from "lucide-react";
import { useLive } from "@/components/providers";
import { Avatar, Badge, Button, Card, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

// 세미나 라이브 룸 — LiveKit 다자간 화상(ADR-019, ADR-002 대체). 'use client' 인터랙티브 섬(R32).
// CRITICAL: `live`는 화면 state로 보관하지 않는다 — 앱 레벨 useLive()가 단일 소스(ADR-001/R5).
// CRITICAL: 접속 토큰은 라우트(/start·/join)에서만 받는다 — 클라가 DB/LiveKit 서버 키를 직접 보지 않는다(R2/R32).
// CRITICAL: 종료(/end)만 전역 종료(파괴적, 확인) — 나가기(/leave)는 본인만(ADR-001/R6·R27).
// 이 단계는 영상 연결 + 타일 + 생명주기까지. 컨트롤바·채팅·반응·타이머는 다음 단계.

export interface LiveRoomMember {
  id: string;
  name: string;
  initial: string;
  color: string;
}

export interface LiveRoomSession {
  id: string;
  presenterId: string;
  /** 현재 접속 중(leftAt=null)인 멤버 id. */
  participantIds: string[];
}

export interface LiveRoomProps {
  currentMemberId: string;
  /** 서버(RSC)에서 주입한 첫 렌더 스냅샷(ADR-015). 없으면 라이브 없음. */
  initialSession: LiveRoomSession | null;
  members: LiveRoomMember[];
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
          <RoomStage
            members={members}
            session={session}
            currentMemberId={currentMemberId}
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
    <Button variant="secondary" onClick={handleLeave}>
      나가기
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 룸 헤더: LIVE 표시(색+텍스트 병행, R29) + 본인 역할에 맞는 액션 */}
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <span
            aria-hidden="true"
            className="anim-livepulse size-2 rounded-full bg-busy"
          />
          <span className="rounded-[10px] bg-busy/10 px-2 py-0.5 text-[11px] font-semibold text-busy">
            LIVE
          </span>
          {presenter ? `${presenter.name}님이 발표 중` : "세미나 진행 중"}
        </span>
        {action}
      </div>

      {body}

      {endError && (
        <p className="text-[12px] text-busy">
          종료하지 못했어요. 잠깐 후 다시 시도해주세요.
        </p>
      )}

      {/* 종료 확인 — 파괴적 액션은 확인을 거친다(R27) */}
      {confirmEnd && (
        <ConfirmEndDialog
          busy={ending}
          onCancel={() => setConfirmEnd(false)}
          onConfirm={handleEnd}
        />
      )}
    </div>
  );
}

/**
 * 룸 stage — LiveKit 컨텍스트 안에서 참가자 타일을 렌더(다음 단계가 컨트롤을 끼울 seam).
 * 화면공유 트랙이 있으면 메인 stage로 크게, 카메라는 filmstrip으로. 없으면 그리드.
 */
function RoomStage({
  members,
  session,
  currentMemberId,
}: {
  members: LiveRoomMember[];
  session: LiveRoomSession;
  currentMemberId: string;
}) {
  const participants = useParticipants();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);

  const screenShare = tracks.find(
    (t) => t.source === Track.Source.ScreenShare && t.publication,
  );
  const cameraOf = (identity: string) =>
    tracks.find(
      (t) =>
        t.source === Track.Source.Camera &&
        t.publication &&
        t.participant?.identity === identity,
    );

  const tiles = participants.map((p) => {
    const member = members.find((m) => m.id === p.identity);
    return (
      <ParticipantTile
        key={p.identity}
        identity={p.identity}
        member={
          member ?? {
            id: p.identity,
            name: p.name || p.identity,
            initial: (p.name || p.identity).slice(0, 1).toUpperCase(),
            color: "var(--fg-faint)",
          }
        }
        cameraTrack={cameraOf(p.identity)}
        isPresenter={p.identity === session.presenterId}
        isSelf={p.identity === currentMemberId}
        speaking={!!p.isSpeaking}
        compact={!!screenShare}
      />
    );
  });

  return (
    <div className="flex flex-col gap-3">
      {/* 음성 재생(트랙 구독). 화면엔 보이지 않는다. */}
      <RoomAudioRenderer />

      {screenShare ? (
        <>
          <Card className="overflow-hidden p-0">
            <div className="grid aspect-video place-items-center bg-bg-subtle">
              <VideoTrack
                trackRef={screenShare}
                className="size-full object-contain"
              />
            </div>
          </Card>
          <div className="flex gap-2 overflow-x-auto pb-1">{tiles}</div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{tiles}</div>
      )}

      <p className="text-[12px] font-semibold text-fg-subtle">
        참가자 {participants.length}명
      </p>
    </div>
  );
}

/** 참가자 타일 — 카메라 트랙이 있으면 비디오, 없으면 아바타(정직한 재현). 발화는 색+텍스트(R29). */
function ParticipantTile({
  identity,
  member,
  cameraTrack,
  isPresenter,
  isSelf,
  speaking,
  compact,
}: {
  identity: string;
  member: LiveRoomMember;
  cameraTrack: TrackReference | undefined;
  isPresenter: boolean;
  isSelf: boolean;
  speaking: boolean;
  compact: boolean;
}) {
  return (
    <div
      data-identity={identity}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-bg-subtle",
        compact ? "w-40 shrink-0" : "",
        speaking ? "border-online ring-2 ring-online/40" : "border-border-token",
      )}
    >
      <div className="grid aspect-video place-items-center">
        {cameraTrack ? (
          <VideoTrack
            trackRef={cameraTrack}
            className="size-full object-cover"
          />
        ) : (
          <Avatar user={member} size="xl" />
        )}
      </div>

      {/* 하단 오버레이: 이름 + 발화 + 역할(색+텍스트 병행, R29) */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-[color-mix(in_oklch,var(--bg)_55%,transparent)] px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg">
          {member.name}
          {isSelf && <span className="ml-1 text-fg-subtle">(나)</span>}
        </span>
        {speaking && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-online">
            <Mic size={11} aria-hidden="true" />
            말하는 중
          </span>
        )}
        {isPresenter ? (
          <Badge variant="admin">
            <Radio size={11} aria-hidden="true" />
            발표자
          </Badge>
        ) : (
          <Badge variant="member">시청자</Badge>
        )}
      </div>
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

/** 종료 확인 다이얼로그(파괴적, R27). 포커스 트랩까지는 다음 단계 — 최소 확인 게이트. */
function ConfirmEndDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
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
        aria-label="라이브 종료 확인"
        className="flex w-full max-w-sm flex-col gap-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-fg">라이브를 종료할까요?</p>
          <p className="text-[13px] text-fg-muted">
            모두의 세션이 끝나요. 다시 시작하려면 새로 열어야 해요.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "종료 중…" : "종료할게요"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
