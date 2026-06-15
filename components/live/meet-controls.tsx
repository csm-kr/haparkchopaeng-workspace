"use client";

import * as React from "react";
import { useLocalParticipant } from "@livekit/components-react";
import {
  Hand,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  Video,
  VideoOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

// 컨트롤바 — Google Meet 스타일. 마이크/카메라/화면공유는 LiveKit 로컬 트랙 API로 토글한다.
// CRITICAL: 화면공유는 발표자(grant 보유)에게만 노출한다 — 서버가 grant로 막지만 UI도 정직하게(R7).
// CRITICAL: 토큰/장치 권한 거부는 정체불명 에러가 아니라 따뜻한 안내로(R30).
// 손들기·반응·채팅 토글은 상위(MeetRoom)가 데이터 채널/패널 상태를 소유하므로 콜백으로 올린다.

/** 컨트롤바 반응 이모지 — 프로토타입과 동일 집합. */
export const REACTIONS = ["👍", "🔥", "👏", "🤔", "🎉"] as const;

export interface MeetControlsProps {
  /** 화면공유 grant 보유(발표자)면 화면공유 버튼 노출(R7). */
  canScreenShare: boolean;
  handUp: boolean;
  panelOpen: boolean;
  onToggleHand: () => void;
  onReact: (emoji: string) => void;
  onTogglePanel: () => void;
}

export function MeetControls({
  canScreenShare,
  handUp,
  panelOpen,
  onToggleHand,
  onReact,
  onTogglePanel,
}: MeetControlsProps) {
  const {
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
    localParticipant,
  } = useLocalParticipant();

  // 장치/권한 거부를 사람 말로 안내(R30). 성공하면 지운다.
  const [notice, setNotice] = React.useState<string | null>(null);

  async function toggle(
    fn: (v: boolean) => Promise<unknown> | void,
    next: boolean,
    deniedMsg: string,
  ) {
    setNotice(null);
    try {
      await fn(next);
    } catch {
      setNotice(deniedMsg);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <CtrlButton
          label={isMicrophoneEnabled ? "음소거" : "마이크"}
          ariaLabel={isMicrophoneEnabled ? "마이크 끄기" : "마이크 켜기"}
          active={isMicrophoneEnabled}
          icon={
            isMicrophoneEnabled ? (
              <Mic size={18} aria-hidden="true" />
            ) : (
              <MicOff size={18} aria-hidden="true" />
            )
          }
          onClick={() =>
            toggle(
              (v) => localParticipant.setMicrophoneEnabled(v),
              !isMicrophoneEnabled,
              "마이크를 켤 수 없어요. 권한과 장치를 확인해주세요.",
            )
          }
        />

        <CtrlButton
          label={isCameraEnabled ? "끄기" : "카메라"}
          ariaLabel={isCameraEnabled ? "카메라 끄기" : "카메라 켜기"}
          active={isCameraEnabled}
          icon={
            isCameraEnabled ? (
              <Video size={18} aria-hidden="true" />
            ) : (
              <VideoOff size={18} aria-hidden="true" />
            )
          }
          onClick={() =>
            toggle(
              (v) => localParticipant.setCameraEnabled(v),
              !isCameraEnabled,
              "카메라를 켤 수 없어요. 권한과 장치를 확인해주세요.",
            )
          }
        />

        {canScreenShare && (
          <CtrlButton
            label="화면 공유"
            ariaLabel={isScreenShareEnabled ? "화면 공유 중지" : "화면 공유 시작"}
            active={isScreenShareEnabled}
            icon={<MonitorUp size={18} aria-hidden="true" />}
            onClick={() =>
              toggle(
                (v) => localParticipant.setScreenShareEnabled(v),
                !isScreenShareEnabled,
                "화면 공유를 시작할 수 없어요. 권한을 확인해주세요.",
              )
            }
          />
        )}

        <CtrlButton
          label="손들기"
          ariaLabel={handUp ? "손 내리기" : "손들기"}
          active={handUp}
          icon={<Hand size={18} aria-hidden="true" />}
          onClick={onToggleHand}
        />

        {/* 반응 — 색이 아니라 이모지(텍스트)로 의미를 전달(R29) */}
        <div className="flex items-center gap-1 rounded-sm bg-bg-subtle px-1.5 py-1">
          {REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={e}
              onClick={() => onReact(e)}
              className="grid size-8 place-items-center rounded-sm text-lg hover:bg-bg-hover"
            >
              {e}
            </button>
          ))}
        </div>

        <CtrlButton
          label="채팅"
          ariaLabel="채팅 열기/닫기"
          active={panelOpen}
          icon={<MessageSquare size={18} aria-hidden="true" />}
          onClick={onTogglePanel}
        />
      </div>

      {notice && <p className="text-[12px] text-busy">{notice}</p>}
    </div>
  );
}

function CtrlButton({
  label,
  ariaLabel,
  active,
  icon,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-w-16 flex-col items-center gap-1 rounded-md px-3 py-2 text-[11px] font-medium transition-colors",
        active
          ? "bg-accent-soft text-accent"
          : "bg-bg-subtle text-fg-muted hover:bg-bg-hover hover:text-fg",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
