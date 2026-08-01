"use client";

import * as React from "react";
import { useLocalParticipant } from "@livekit/components-react";
import {
  BackgroundProcessor,
  supportsBackgroundProcessors,
} from "@livekit/track-processors";
import {
  Check,
  Eye,
  EyeOff,
  Hand,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  Presentation,
  Sparkles,
  Video,
  VideoOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  applyCameraBackground,
  type BackgroundProcessorHandle,
  type CameraBackground,
  type CameraProcessorTrack,
} from "@/lib/video-background";

// 컨트롤바 — Google Meet 스타일. 마이크/카메라/화면공유는 LiveKit 로컬 트랙 API로 토글한다.
// CRITICAL: 화면공유는 발표자(grant 보유)에게만 노출한다 — 서버가 grant로 막지만 UI도 정직하게(R7).
// CRITICAL: 토큰/장치 권한 거부는 정체불명 에러가 아니라 따뜻한 안내로(R30).
// 손들기·반응·채팅 토글은 상위(MeetRoom)가 데이터 채널/패널 상태를 소유하므로 콜백으로 올린다.
// '내 얼굴' 버튼은 로컬 뷰만 바꾼다 — 트랙을 끄지 않으므로 상대 화면엔 그대로 보인다(카메라 끄기와 구분).

/** 컨트롤바 반응 이모지 — 프로토타입과 동일 집합. */
export const REACTIONS = ["👍", "🔥", "👏", "🤔", "🎉"] as const;

/** 흐림 강도 3단계 — 강(28)은 이전 고정값(10)보다 확실히 세다. */
const BLUR_LEVELS = [
  { key: "low", label: "흐림 약하게", short: "약", radius: 8 },
  { key: "mid", label: "흐림 보통", short: "중", radius: 16 },
  { key: "high", label: "흐림 강하게", short: "강", radius: 28 },
] as const;

/** 가상 배경 프리셋 — /public/backgrounds/의 자체 생성 이미지(파일 교체로 실사 전환 가능). */
const IMAGE_PRESETS = [
  { key: "hawaii", label: "하와이 해변", path: "/backgrounds/hawaii.webp" },
  { key: "sky", label: "맑은 하늘", path: "/backgrounds/sky.webp" },
  { key: "study", label: "심플 서재", path: "/backgrounds/study.webp" },
] as const;

export interface MeetControlsProps {
  /** 화면공유 grant 보유(발표자)면 화면공유 버튼 노출(R7). */
  canScreenShare: boolean;
  /** 발표자면 발표자료 공유 버튼 노출(R7). */
  canPresent: boolean;
  /** 발표자료를 공유 중이면 버튼이 '공유 중지'로. */
  presenting: boolean;
  handUp: boolean;
  panelOpen: boolean;
  onToggleHand: () => void;
  onReact: (emoji: string) => void;
  onTogglePanel: () => void;
  /** 발표자료 공유 시작 — 자료 패널을 연다. */
  onOpenPresent: () => void;
  /** 발표자료 공유 중지. */
  onStopPresent: () => void;
  /** 내 화면에서만 내 얼굴을 숨긴 상태. */
  hideSelf: boolean;
  /** 내 얼굴 숨기기 토글. */
  onToggleHideSelf: () => void;
}

export function MeetControls({
  canScreenShare,
  canPresent,
  presenting,
  handUp,
  panelOpen,
  onToggleHand,
  onReact,
  onTogglePanel,
  onOpenPresent,
  onStopPresent,
  hideSelf,
  onToggleHideSelf,
}: MeetControlsProps) {
  const {
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
    cameraTrack,
    localParticipant,
  } = useLocalParticipant();

  // 장치/권한 거부를 사람 말로 안내(R30). 성공하면 지운다.
  const [notice, setNotice] = React.useState<string | null>(null);

  const track = cameraTrack?.track as CameraProcessorTrack | undefined;
  // 현재 붙어 있는 배경 선택. 프로세서 인스턴스는 ref로 보유하고 switchTo로 전환한다(깜빡임 방지).
  const [background, setBackground] = React.useState<CameraBackground>({
    kind: "off",
  });
  const [menuOpen, setMenuOpen] = React.useState(false);
  const processorRef = React.useRef<BackgroundProcessorHandle | null>(null);
  const attachedTrackRef = React.useRef<unknown>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // 카메라 트랙이 바뀌면(껐다 켜기 등) 이전 프로세서는 스테일 → 선택을 끄기로 리셋하고 ref를 비운다.
  React.useEffect(() => {
    if (attachedTrackRef.current && attachedTrackRef.current !== track) {
      processorRef.current = null;
      attachedTrackRef.current = null;
      setBackground({ kind: "off" });
    }
  }, [track]);

  // 팝오버 바깥 클릭·Esc로 닫기.
  React.useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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

  // 선택한 배경으로 맞춘다 — lib가 create+setProcessor(최초)/switchTo(전환)/stopProcessor(끄기)를 분기.
  // 미지원·카메라 꺼짐·실패는 던지지 않고 따뜻하게 안내한다(R30).
  async function selectBackground(bg: CameraBackground) {
    setNotice(null);
    const result = await applyCameraBackground(track, bg, processorRef.current, {
      isSupported: supportsBackgroundProcessors,
      createProcessor: makeProcessor,
    });
    if (result.outcome === "applied" || result.outcome === "removed") {
      processorRef.current = result.processor;
      attachedTrackRef.current = result.processor ? track : null;
      setBackground(bg);
      return;
    }
    if (result.outcome === "no-track") {
      setNotice("카메라를 먼저 켜주세요. 배경은 카메라가 켜져 있을 때 바꿀 수 있어요.");
    } else if (result.outcome === "unsupported") {
      setNotice("이 브라우저에선 배경 변경을 지원하지 않아요.");
    } else {
      setNotice("배경을 바꿀 수 없어요. 잠시 후 다시 시도해주세요.");
    }
  }

  const isOff = background.kind === "off";
  const blurChecked = (radius: number) =>
    background.kind === "blur" && background.radius === radius;
  const imageChecked = (path: string) =>
    background.kind === "image" && background.path === path;

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

        {/* 내 얼굴 숨기기 — 내 화면에서만 숨긴다(카메라 끄기와 달리 상대에겐 계속 보인다). */}
        <CtrlButton
          label="내 얼굴"
          ariaLabel={hideSelf ? "내 얼굴 다시 보기" : "내 화면에서 내 얼굴 숨기기"}
          active={hideSelf}
          icon={
            hideSelf ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )
          }
          onClick={() => {
            // 카메라 끄기와 헷갈리지 않게 켤 때 한 줄 안내(R30). 끌 땐 지운다.
            setNotice(
              hideSelf
                ? null
                : "내 화면에서만 숨겼어요. 친구들에겐 그대로 보여요.",
            );
            onToggleHideSelf();
          }}
        />

        {/* 배경 — 끄기/흐림(강도)/이미지를 팝오버에서 고른다(MediaPipe, 브라우저 내 처리). 누구나 사용. */}
        <div className="relative" ref={menuRef}>
          <CtrlButton
            label="배경"
            ariaLabel="배경 선택"
            active={!isOff}
            icon={<Sparkles size={18} aria-hidden="true" />}
            onClick={() => setMenuOpen((o) => !o)}
            hasPopup
            expanded={menuOpen}
          />
          {menuOpen && (
            <div
              role="menu"
              aria-label="카메라 배경"
              className="absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg border border-border bg-bg p-2 shadow-lg"
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={isOff}
                onClick={() => selectBackground({ kind: "off" })}
                className={cn(
                  "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-[13px]",
                  isOff ? "bg-accent-soft font-medium text-accent" : "text-fg hover:bg-bg-hover",
                )}
              >
                <span>끄기</span>
                {isOff && <Check size={14} aria-hidden="true" />}
              </button>

              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="text-[12px] text-fg-muted">흐림</span>
                <div className="flex gap-1">
                  {BLUR_LEVELS.map((l) => (
                    <button
                      key={l.key}
                      type="button"
                      role="menuitemradio"
                      aria-label={l.label}
                      aria-checked={blurChecked(l.radius)}
                      onClick={() =>
                        selectBackground({ kind: "blur", radius: l.radius })
                      }
                      className={cn(
                        "grid size-7 place-items-center rounded-sm text-[12px]",
                        blurChecked(l.radius)
                          ? "bg-accent-soft font-semibold text-accent ring-1 ring-accent"
                          : "bg-bg-subtle text-fg-muted hover:bg-bg-hover",
                      )}
                    >
                      {l.short}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-1 grid grid-cols-3 gap-1">
                {IMAGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="menuitemradio"
                    aria-label={p.label}
                    aria-checked={imageChecked(p.path)}
                    onClick={() => selectBackground({ kind: "image", path: p.path })}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-sm p-1 text-[10px]",
                      imageChecked(p.path)
                        ? "font-semibold text-accent ring-1 ring-accent"
                        : "text-fg-muted hover:bg-bg-hover",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="h-10 w-full rounded-sm bg-bg-subtle bg-cover bg-center"
                      style={{ backgroundImage: `url(${p.path})` }}
                    />
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

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

        {/* 발표자료 공유 — 업로드 PDF를 무대에 직접 띄운다(OS 화면공유 아님). 발표자만(R7). */}
        {canPresent && (
          <CtrlButton
            label={presenting ? "공유 중지" : "발표자료"}
            ariaLabel={presenting ? "발표자료 공유 중지" : "발표자료 공유"}
            active={presenting}
            icon={<Presentation size={18} aria-hidden="true" />}
            onClick={presenting ? onStopPresent : onOpenPresent}
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

  /** 선택한 배경으로 track-processors 프로세서를 생성 — createProcessor deps(최초 부착 시). */
  function makeProcessor(bg: CameraBackground): BackgroundProcessorHandle {
    const opts =
      bg.kind === "image"
        ? { mode: "virtual-background" as const, imagePath: bg.path }
        : {
            mode: "background-blur" as const,
            blurRadius: bg.kind === "blur" ? bg.radius : 16,
          };
    return BackgroundProcessor(opts) as unknown as BackgroundProcessorHandle;
  }
}

function CtrlButton({
  label,
  ariaLabel,
  active,
  icon,
  onClick,
  hasPopup,
  expanded,
}: {
  label: string;
  ariaLabel: string;
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  hasPopup?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      aria-haspopup={hasPopup ? "menu" : undefined}
      aria-expanded={hasPopup ? expanded : undefined}
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
