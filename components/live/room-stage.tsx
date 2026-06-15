"use client";

import * as React from "react";
import {
  RoomAudioRenderer,
  VideoTrack,
  useParticipants,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Hand, Maximize, Mic, Minimize, Minus, Plus, Radio } from "lucide-react";
import { Avatar, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  AnnotationOverlay,
  type ActiveAnnotation,
  type DrawInput,
} from "./annotation-overlay";
import type { LiveMember } from "./types";

// 룸 stage — LiveKit 컨텍스트 안에서 참가자 타일을 렌더한다.
// 화면공유가 있으면: 공유 화면(왼쪽 크게, '발표 중' 라벨) + 얼굴 세로 스트립(오른쪽, 개수 −/+ 조절).
//   보이는 얼굴 우선순위: 말하는 사람 → 발표자 → 나머지. 개수는 state라 공유 소스가 바뀌어도 유지된다.
// 화면공유가 없으면: 전원 그리드.
// CRITICAL: 발화·역할·손들기·발표 표시는 색에만 의존하지 않는다 — 아이콘 + 텍스트 병행(R29). 토큰만(R20).

export interface RoomStageProps {
  members: LiveMember[];
  presenterId: string;
  currentMemberId: string;
  /** 손든 참가자 identity 집합. */
  hands: Set<string>;
  /** 화면공유 주석(펜/레이저) — 부모(MeetRoom)가 데이터 채널로 모은 것. */
  annotations?: ActiveAnnotation[];
  /** 발표자가 그릴 때 호출(없으면 그리기 비활성). */
  onDraw?: (input: DrawInput) => void;
}

interface StripParticipant {
  identity: string;
  name?: string;
  isSpeaking?: boolean;
}

/**
 * 사이드 스트립 정렬: 말하는 사람 → 발표자 → 나머지. 동점이면 원래 순서를 보존(안정 정렬).
 */
export function orderParticipantsForStrip<P extends StripParticipant>(
  participants: P[],
  presenterId: string,
): P[] {
  const score = (p: P) =>
    (p.isSpeaking ? 2 : 0) + (p.identity === presenterId ? 1 : 0);
  return participants
    .map((p, i) => ({ p, i }))
    .sort((a, b) => score(b.p) - score(a.p) || a.i - b.i)
    .map((x) => x.p);
}

export function RoomStage({
  members,
  presenterId,
  currentMemberId,
  hands,
  annotations,
  onDraw,
}: RoomStageProps) {
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

  // 오른쪽 스트립에 보일 얼굴 수 — 공유 소스가 바뀌어도 유지(컴포넌트 state).
  const [visibleCount, setVisibleCount] = React.useState(2);

  const renderTile = (p: StripParticipant) => {
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
        isPresenter={p.identity === presenterId}
        isSelf={p.identity === currentMemberId}
        speaking={!!p.isSpeaking}
        handUp={hands.has(p.identity)}
      />
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 음성 재생(트랙 구독). 화면엔 보이지 않는다. */}
      <RoomAudioRenderer />

      {screenShare ? (
        <ScreenShareStage
          screenShare={screenShare}
          presenterName={
            members.find(
              (m) => m.id === (screenShare.participant?.identity ?? presenterId),
            )?.name ?? "발표자"
          }
          isPresenter={currentMemberId === presenterId}
          annotations={annotations ?? []}
          onDraw={onDraw}
          count={visibleCount}
          max={participants.length}
          onCountChange={setVisibleCount}
        >
          {orderParticipantsForStrip(participants, presenterId)
            .slice(0, Math.min(visibleCount, participants.length))
            .map(renderTile)}
        </ScreenShareStage>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {participants.map(renderTile)}
        </div>
      )}
    </div>
  );
}

/**
 * 화면공유 stage — 공유 화면(크게) + 얼굴 스트립 + 주석. 전체화면 토글을 소유한다.
 * 전체화면에선 영상이 화면을 채우고 얼굴 스트립은 우측 오버레이로 떠 따라온다.
 * 좌표 정규화(annotation-overlay)는 박스 기준이라 전체화면에서도 모두에게 같은 위치.
 * 그리기는 발표자만(onDraw 유무) — 시청자는 전체화면으로 크게 보기만(R7).
 */
function ScreenShareStage({
  screenShare,
  presenterName,
  isPresenter,
  annotations,
  onDraw,
  count,
  max,
  onCountChange,
  children,
}: {
  screenShare: TrackReference;
  presenterName: string;
  isPresenter: boolean;
  annotations: ActiveAnnotation[];
  onDraw?: (input: DrawInput) => void;
  count: number;
  max: number;
  onCountChange: (n: number) => void;
  children: React.ReactNode;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = React.useState(false);

  React.useEffect(() => {
    const el = containerRef.current;
    const onChange = () => setIsFs(document.fullscreenElement === el);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      // 공유 종료 등으로 언마운트될 때 이 컨테이너가 전체화면이면 해제.
      if (document.fullscreenElement === el) void document.exitFullscreen?.();
    };
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void containerRef.current?.requestFullscreen?.(); // 미지원 → no-op
  };

  return (
    <div
      ref={containerRef}
      className={cn("flex gap-3", isFs && "relative h-screen w-screen bg-black")}
    >
      {/* 공유 화면 + 발표 중 라벨 + 전체화면 토글 + 주석 */}
      <div
        className={cn(
          "relative overflow-hidden",
          isFs
            ? "absolute inset-0"
            : "min-w-0 flex-1 rounded-lg border border-border-token",
        )}
      >
        <div
          className={cn(
            "grid place-items-center",
            isFs ? "size-full bg-black" : "aspect-video bg-bg-subtle",
          )}
        >
          <VideoTrack
            trackRef={screenShare}
            className="size-full object-contain"
          />
        </div>
        <PresentingLabel name={presenterName} />
        <FsButton isFs={isFs} onClick={toggleFs} />
        <AnnotationOverlay
          isPresenter={isPresenter}
          annotations={annotations}
          onDraw={onDraw}
        />
      </div>

      {/* 얼굴 스트립 — 일반은 우측 컬럼, 전체화면은 우측 오버레이로 따라온다 */}
      <FaceStrip
        count={count}
        max={max}
        onCountChange={onCountChange}
        floating={isFs}
      >
        {children}
      </FaceStrip>
    </div>
  );
}

/** 전체화면 토글 — 공유 화면 우상단. 색만이 아니라 아이콘+레이블(R29). */
function FsButton({ isFs, onClick }: { isFs: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={isFs ? "전체화면 종료" : "전체화면"}
      onClick={onClick}
      className="absolute top-2 right-2 z-20 grid size-8 place-items-center rounded-md bg-bg-elevated/90 text-fg-muted shadow-[var(--shadow-sm)] hover:bg-bg-hover hover:text-fg"
    >
      {isFs ? (
        <Minimize size={15} aria-hidden="true" />
      ) : (
        <Maximize size={15} aria-hidden="true" />
      )}
    </button>
  );
}

/** 공유 화면 위 '발표 중' 라벨 — 색 알약 + 텍스트(R29), 토큰만(R20). */
function PresentingLabel({ name }: { name: string }) {
  return (
    <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-[10px] bg-busy px-2 py-0.5 text-[11px] font-semibold text-accent-fg">
      <Radio size={11} aria-hidden="true" />
      {name}님이 발표 중
    </span>
  );
}

/** 오른쪽 얼굴 스트립 + 표시 개수 −/+ 조절. 한도(max=참가자 수) 안에서 1..max. */
function FaceStrip({
  count,
  max,
  onCountChange,
  floating = false,
  children,
}: {
  count: number;
  max: number;
  onCountChange: (n: number) => void;
  /** 전체화면일 때 공유 화면 위 우측 오버레이로 띄운다(가독성 위해 반투명 배경). */
  floating?: boolean;
  children: React.ReactNode;
}) {
  const clamped = Math.min(Math.max(1, count), Math.max(1, max));
  return (
    <div
      className={cn(
        "flex w-40 shrink-0 flex-col gap-2 sm:w-44",
        floating &&
          "absolute top-1/2 right-3 z-10 max-h-[calc(100vh-1.5rem)] -translate-y-1/2 rounded-lg bg-bg-elevated/85 p-2 backdrop-blur",
      )}
    >
      <div className="flex items-center justify-between rounded-md bg-bg-subtle px-2 py-1">
        <span className="text-[11px] font-medium text-fg-subtle">
          얼굴 {clamped}
        </span>
        <span className="flex items-center gap-0.5">
          <StepButton
            label="얼굴 수 줄이기"
            disabled={clamped <= 1}
            onClick={() => onCountChange(clamped - 1)}
          >
            <Minus size={13} aria-hidden="true" />
          </StepButton>
          <StepButton
            label="얼굴 수 늘리기"
            disabled={clamped >= max}
            onClick={() => onCountChange(clamped + 1)}
          >
            <Plus size={13} aria-hidden="true" />
          </StepButton>
        </span>
      </div>
      <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** 참가자 타일 — 카메라 트랙이 있으면 비디오, 없으면 아바타. 발화/손들기는 색+텍스트(R29). */
function ParticipantTile({
  identity,
  member,
  cameraTrack,
  isPresenter,
  isSelf,
  speaking,
  handUp,
}: {
  identity: string;
  member: LiveMember;
  cameraTrack: TrackReference | undefined;
  isPresenter: boolean;
  isSelf: boolean;
  speaking: boolean;
  handUp: boolean;
}) {
  return (
    <div
      data-identity={identity}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-bg-subtle",
        speaking ? "border-online ring-2 ring-online/40" : "border-border-token",
      )}
    >
      <div className="grid aspect-video place-items-center">
        {cameraTrack ? (
          <VideoTrack trackRef={cameraTrack} className="size-full object-cover" />
        ) : (
          <Avatar user={member} size="xl" />
        )}
      </div>

      {/* 손든 참가자 — 색+아이콘+텍스트 병행(R29) */}
      {handUp && (
        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-[10px] bg-away/20 px-1.5 py-0.5 text-[11px] font-medium text-away">
          <Hand size={11} aria-hidden="true" />손
        </span>
      )}

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
