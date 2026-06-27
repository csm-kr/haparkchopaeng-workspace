// 카메라 배경 블러 토글 — 오케스트레이션만 담당한다.
// 실제 세그멘테이션은 브라우저 MediaPipe(@livekit/track-processors)가 처리하므로
// 지원 여부 확인·프로세서 생성은 deps로 주입한다(단위테스트가 GPU 없이 돈다).
// CRITICAL: 미지원/실패는 던지지 않고 결과로 알린다 — 호출부가 따뜻하게 안내한다(R30).

export type BlurOutcome =
  | "applied"
  | "removed"
  | "unsupported"
  | "no-track"
  | "error";

/** 프로세서를 붙이고 뗄 수 있는 로컬 비디오 트랙(LiveKit LocalVideoTrack의 부분 타입). */
export interface CameraProcessorTrack {
  setProcessor: (processor: unknown) => Promise<void>;
  stopProcessor: () => Promise<void>;
}

export interface BlurDeps {
  /** 브라우저가 배경 프로세서를 지원하는지(@livekit/track-processors). */
  isSupported: () => boolean;
  /** 배경 블러 프로세서 생성(@livekit/track-processors BackgroundBlur). */
  createBlur: () => unknown;
}

/**
 * 로컬 카메라 트랙의 배경 블러를 켜거나 끈다.
 * - 트랙이 없으면(카메라 꺼짐) "no-track".
 * - 끄기는 항상 stopProcessor로 제거.
 * - 켜기는 지원될 때만 setProcessor로 적용("unsupported" 게이팅).
 * - 트랙 API 실패는 삼키고 "error"로 보고(graceful).
 */
export async function setCameraBlur(
  track: CameraProcessorTrack | null | undefined,
  enabled: boolean,
  deps: BlurDeps,
): Promise<BlurOutcome> {
  if (!track) return "no-track";

  if (!enabled) {
    try {
      await track.stopProcessor();
      return "removed";
    } catch {
      return "error";
    }
  }

  if (!deps.isSupported()) return "unsupported";

  try {
    await track.setProcessor(deps.createBlur());
    return "applied";
  } catch {
    return "error";
  }
}
