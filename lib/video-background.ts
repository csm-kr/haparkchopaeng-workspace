// 카메라 배경 선택(끄기/흐림/이미지) — 오케스트레이션만 담당한다.
// 실제 세그멘테이션은 브라우저 MediaPipe(@livekit/track-processors)가 처리하므로
// 지원 여부 확인·프로세서 생성은 deps로 주입한다(단위테스트가 GPU 없이 돈다).
// CRITICAL: 미지원/실패는 던지지 않고 결과로 알린다 — 호출부가 따뜻하게 안내한다(R30).
//
// 프로세서 인스턴스는 lib가 아니라 호출부(컴포넌트)가 보유한다: 현재 프로세서를 인자로 받고
// 새 상태를 결과로 반환한다. 이미 붙어 있으면 switchTo로 매끄럽게 전환(깜빡임 방지),
// 없으면 새로 만들어 setProcessor로 붙인다.

export type BackgroundOutcome =
  | "applied"
  | "removed"
  | "unsupported"
  | "no-track"
  | "error";

/** 카메라 배경 선택 — 끄기 / 흐림(강도) / 이미지(경로). */
export type CameraBackground =
  | { kind: "off" }
  | { kind: "blur"; radius: number }
  | { kind: "image"; path: string };

/** 프로세서를 붙이고 뗄 수 있는 로컬 비디오 트랙(LiveKit LocalVideoTrack의 부분 타입). */
export interface CameraProcessorTrack {
  setProcessor: (processor: unknown) => Promise<void>;
  stopProcessor: () => Promise<void>;
}

/** 붙인 뒤 모드를 전환할 수 있는 프로세서(track-processors BackgroundProcessorWrapper의 부분 타입). */
export interface BackgroundProcessorHandle {
  switchTo: (
    options:
      | { mode: "background-blur"; blurRadius: number }
      | { mode: "virtual-background"; imagePath: string }
      | { mode: "disabled" },
  ) => Promise<void>;
}

export interface BackgroundDeps {
  /** 브라우저가 배경 프로세서를 지원하는지(@livekit/track-processors). */
  isSupported: () => boolean;
  /** 선택한 배경으로 프로세서를 생성(@livekit/track-processors BackgroundProcessor). */
  createProcessor: (background: CameraBackground) => BackgroundProcessorHandle;
}

export interface ApplyResult {
  outcome: BackgroundOutcome;
  /** 적용 후 프로세서 상태 — off면 null, 아니면 붙어 있는 핸들(호출부가 다음 호출에 넘긴다). */
  processor: BackgroundProcessorHandle | null;
}

/** 배경 선택 → switchTo 옵션. off는 여기서 다루지 않는다(stopProcessor로 제거). */
function switchOptions(
  background: Exclude<CameraBackground, { kind: "off" }>,
):
  | { mode: "background-blur"; blurRadius: number }
  | { mode: "virtual-background"; imagePath: string } {
  return background.kind === "blur"
    ? { mode: "background-blur", blurRadius: background.radius }
    : { mode: "virtual-background", imagePath: background.path };
}

/**
 * 로컬 카메라 트랙의 배경을 선택한 값으로 맞춘다.
 * - 트랙이 없으면(카메라 꺼짐) "no-track"(현재 프로세서 유지).
 * - off: 붙어 있으면 stopProcessor로 제거, 아니면 그대로. 결과 프로세서는 null.
 * - blur/image: 지원될 때만. 붙어 있으면 switchTo로 전환, 없으면 생성+setProcessor.
 * - 트랙/프로세서 API 실패는 삼키고 "error"로 보고(graceful, R30).
 */
export async function applyCameraBackground(
  track: CameraProcessorTrack | null | undefined,
  background: CameraBackground,
  current: BackgroundProcessorHandle | null,
  deps: BackgroundDeps,
): Promise<ApplyResult> {
  if (!track) return { outcome: "no-track", processor: current };

  if (background.kind === "off") {
    if (!current) return { outcome: "removed", processor: null };
    try {
      await track.stopProcessor();
      return { outcome: "removed", processor: null };
    } catch {
      return { outcome: "error", processor: current };
    }
  }

  if (!deps.isSupported()) return { outcome: "unsupported", processor: current };

  try {
    if (current) {
      await current.switchTo(switchOptions(background));
      return { outcome: "applied", processor: current };
    }
    const processor = deps.createProcessor(background);
    await track.setProcessor(processor);
    return { outcome: "applied", processor };
  } catch {
    return { outcome: "error", processor: current };
  }
}
