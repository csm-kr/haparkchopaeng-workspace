"use client";

import {
  RoomAudioRenderer,
  VideoTrack,
  useParticipants,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Hand, Mic, Radio } from "lucide-react";
import { Avatar, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { LiveMember } from "./types";

// 룸 stage — LiveKit 컨텍스트 안에서 참가자 타일을 렌더한다.
// 화면공유 트랙이 있으면 메인 stage로 크게, 카메라는 filmstrip으로. 없으면 그리드.
// CRITICAL: 발화·역할·손들기는 색에만 의존하지 않는다 — 아이콘 + 텍스트 병행(R29).

export interface RoomStageProps {
  members: LiveMember[];
  presenterId: string;
  currentMemberId: string;
  /** 손든 참가자 identity 집합. */
  hands: Set<string>;
}

export function RoomStage({
  members,
  presenterId,
  currentMemberId,
  hands,
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
        isPresenter={p.identity === presenterId}
        isSelf={p.identity === currentMemberId}
        speaking={!!p.isSpeaking}
        handUp={hands.has(p.identity)}
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
          <div className="overflow-hidden rounded-lg border border-border-token">
            <div className="grid aspect-video place-items-center bg-bg-subtle">
              <VideoTrack
                trackRef={screenShare}
                className="size-full object-contain"
              />
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">{tiles}</div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{tiles}</div>
      )}
    </div>
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
  compact,
}: {
  identity: string;
  member: LiveMember;
  cameraTrack: TrackReference | undefined;
  isPresenter: boolean;
  isSelf: boolean;
  speaking: boolean;
  handUp: boolean;
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
