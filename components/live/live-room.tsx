"use client";

import * as React from "react";
import { Copy, Radio, Video } from "lucide-react";
import { useLive } from "@/components/providers";
import { Avatar, Badge, Button, Card, EmptyState } from "@/components/ui";
import { HlsPlayer } from "./hls-player";

// 세미나 라이브 룸 — 'use client' 인터랙티브 섬(R32).
// CRITICAL: `live`는 화면 state로 보관하지 않는다 — 앱 레벨 useLive()가 단일 소스(ADR-001/R5).
// CRITICAL: 송출 자격증명(RTMPS/Stream Key·SRT)은 발표자 본인 뷰에만(SECURITY/R7).
// CRITICAL: 종료(/end)만 전역 종료(파괴적, 확인) — 나가기(/leave)는 본인만(ADR-001/R6·R27).
// CRITICAL: DB/Cloudflare 직접 호출 금지 — route handler만 fetch(API.md).

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

interface Credentials {
  rtmps: { url: string; streamKey: string };
  srt: { url: string; streamId: string; passphrase: string };
}

/** 시작/입장/종료/나가기 중 에러 분기. */
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
  const [credentials, setCredentials] = React.useState<Credentials | null>(null);
  const [playback, setPlayback] = React.useState<{ hls: string } | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [startError, setStartError] = React.useState<StartError>(null);
  const [confirmEnd, setConfirmEnd] = React.useState(false);
  const [ending, setEnding] = React.useState(false);
  const [endError, setEndError] = React.useState(false);
  const [left, setLeft] = React.useState(false);

  const isPresenter = !!session && session.presenterId === currentMemberId;

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

  // 시청자: 룸에 들어오면 시청 등록(join) → 재생 정보(HLS) 수신. 발표자는 송출자라 join 안 함.
  React.useEffect(() => {
    if (!live || !session || isPresenter || left || playback) return;
    let cancelled = false;
    fetch(`/api/live/${session.id}/join`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setPlayback({ hls: j?.data?.playback?.hls ?? "" });
      })
      .catch(() => {
        if (!cancelled) setPlayback({ hls: "" });
      });
    return () => {
      cancelled = true;
    };
  }, [live, session, isPresenter, left, playback]);

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const r = await fetch("/api/live/start", { method: "POST" });
      if (r.status === 409) {
        setStartError("conflict");
        return;
      }
      if (!r.ok) {
        setStartError("error");
        return;
      }
      const j = await r.json();
      setSession({
        id: j.data.session.id,
        presenterId: j.data.session.presenterId,
        participantIds: [j.data.session.presenterId],
      });
      setCredentials({ rtmps: j.data.rtmps, srt: j.data.srt });
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
      setCredentials(null);
      setPlayback(null);
      setLive(false); // 낙관적 — Realtime이 확정
    } catch {
      setEndError(true);
    } finally {
      setEnding(false);
    }
  }

  // 나가기: 본인만 퇴장. 전역 live는 유지(전역 종료 아님, R6).
  async function handleLeave() {
    if (!session) return;
    setLeft(true);
    setPlayback(null);
    try {
      await fetch(`/api/live/${session.id}/leave`, { method: "POST" });
    } catch {
      // best-effort — 화면은 이미 퇴장 상태로 전환
    }
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
                지금은 시작할 수 없어요. 잠깐 후 다시 시도해주세요.
              </p>
            )}
          </div>
        }
      />
    );
  }

  // ── 라이브 중인데 로컬 세션 정보 보강 전 ────────────────────────────
  if (!session) {
    return (
      <Card
        role="status"
        className="grid place-items-center px-6 py-12 text-center"
      >
        <p className="text-[13px] text-fg-muted">라이브 룸을 불러오는 중이에요…</p>
      </Card>
    );
  }

  const presenter = members.find((m) => m.id === session.presenterId);
  // 현재 접속자: 발표자 + 참가자(중복 제거).
  const attendeeIds = Array.from(
    new Set([session.presenterId, ...session.participantIds]),
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
        {isPresenter ? (
          <Button variant="danger" onClick={() => setConfirmEnd(true)}>
            라이브 종료
          </Button>
        ) : (
          <Button variant="secondary" onClick={handleLeave}>
            나가기
          </Button>
        )}
      </div>

      {/* 본문: 발표자=송출 안내 / 시청자=플레이어 */}
      {isPresenter ? (
        <PresenterPanel credentials={credentials} />
      ) : left ? (
        <Card className="grid place-items-center gap-3 px-6 py-12 text-center">
          <p className="text-[13px] text-fg-muted">라이브에서 나왔어요.</p>
          <Button onClick={() => setLeft(false)}>다시 입장</Button>
        </Card>
      ) : (
        <HlsPlayer src={playback?.hls ?? ""} />
      )}

      {/* 참가자 목록 — 색+텍스트로 발표자/시청자 구분(R29) */}
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-[12px] font-semibold text-fg-subtle">
          참가자 {attendeeIds.length}명
        </p>
        <ul className="flex flex-col gap-2">
          {attendeeIds.map((id) => {
            const m = members.find((x) => x.id === id);
            if (!m) return null;
            const presenting = id === session.presenterId;
            return (
              <li key={id} className="flex items-center gap-2.5">
                <Avatar user={m} size="md" />
                <span className="flex-1 truncate text-[13px] text-fg">
                  {m.name}
                  {id === currentMemberId && (
                    <span className="ml-1 text-fg-subtle">(나)</span>
                  )}
                </span>
                {presenting ? (
                  <Badge variant="admin">
                    <Radio size={11} aria-hidden="true" />
                    발표자
                  </Badge>
                ) : (
                  <Badge variant="member">시청자</Badge>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

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

/** 발표자 송출 안내 — RTMPS/Stream Key·SRT를 복사 버튼으로. 본인에게만 보인다(R7). */
function PresenterPanel({ credentials }: { credentials: Credentials | null }) {
  if (!credentials) {
    // 새로고침 등으로 자격증명이 없으면(키는 시작 시 1회만) graceful 안내(R30).
    return (
      <Card className="flex flex-col gap-2 p-4">
        <p className="text-[13px] font-semibold text-fg">발표자 송출</p>
        <p className="text-[13px] text-fg-muted">
          송출 정보는 라이브를 시작한 화면에서만 보여요. 새 정보가 필요하면 종료 후
          다시 시작해주세요.
        </p>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-semibold text-fg">발표자 송출 정보</p>
        <p className="text-[12px] text-fg-muted">
          OBS 등에 아래 정보를 넣어 송출하세요. 이 정보는 발표자 본인에게만 보여요.
        </p>
      </div>
      <CopyField label="RTMPS URL" value={credentials.rtmps.url} />
      <CopyField label="Stream Key" value={credentials.rtmps.streamKey} secret />
      <CopyField label="SRT URL" value={credentials.srt.url} />
      <CopyField label="SRT Passphrase" value={credentials.srt.passphrase} secret />
    </Card>
  );
}

function CopyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 클립보드 미지원 — 값은 화면에 노출돼 있으니 수동 복사 가능
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-fg-subtle">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-sm border border-border-token bg-bg-subtle px-2.5 py-1.5 font-mono text-[12px] text-fg">
          {value}
        </code>
        <Button
          variant="secondary"
          size="sm"
          onClick={copy}
          aria-label={`${label} 복사`}
        >
          <Copy size={13} aria-hidden="true" />
          {copied ? "복사됨" : "복사"}
        </Button>
      </div>
      {secret && (
        <span className="text-[11px] text-fg-subtle">
          이 값은 공유하지 마세요.
        </span>
      )}
    </div>
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
