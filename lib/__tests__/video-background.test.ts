import { describe, expect, it, vi } from "vitest";
import { setCameraBlur, type BlurDeps } from "@/lib/video-background";

// lib/video-background.ts 단위 테스트 — 카메라 배경 블러 토글의 오케스트레이션.
// 실제 MediaPipe 세그멘테이션은 브라우저 GPU에서만 도므로, LiveKit/track-processors API는
// 주입(deps)으로 대체한다. 우리 코드의 분기(지원 게이팅·적용/제거·graceful 실패)만 검증한다.

function makeTrack() {
  return {
    setProcessor: vi.fn().mockResolvedValue(undefined),
    stopProcessor: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(overrides: Partial<BlurDeps> = {}): BlurDeps {
  return {
    isSupported: () => true,
    createBlur: () => ({ name: "blur" }),
    ...overrides,
  };
}

describe("setCameraBlur", () => {
  it("켜기 + 지원됨 + 트랙 있음 → 프로세서를 적용하고 'applied'", async () => {
    const track = makeTrack();
    const processor = { name: "blur" };
    const deps = makeDeps({ createBlur: () => processor });

    const outcome = await setCameraBlur(track, true, deps);

    expect(outcome).toBe("applied");
    expect(track.setProcessor).toHaveBeenCalledWith(processor);
    expect(track.stopProcessor).not.toHaveBeenCalled();
  });

  it("끄기 + 트랙 있음 → 프로세서를 제거하고 'removed'(setProcessor 미호출)", async () => {
    const track = makeTrack();

    const outcome = await setCameraBlur(track, false, makeDeps());

    expect(outcome).toBe("removed");
    expect(track.stopProcessor).toHaveBeenCalledOnce();
    expect(track.setProcessor).not.toHaveBeenCalled();
  });

  it("켜기 + 미지원 → 'unsupported'(프로세서 미적용)", async () => {
    const track = makeTrack();
    const deps = makeDeps({ isSupported: () => false });

    const outcome = await setCameraBlur(track, true, deps);

    expect(outcome).toBe("unsupported");
    expect(track.setProcessor).not.toHaveBeenCalled();
  });

  it("트랙 없음(카메라 꺼짐) → 'no-track'(아무 호출 없음)", async () => {
    const outcome = await setCameraBlur(null, true, makeDeps());
    expect(outcome).toBe("no-track");
  });

  it("켜기 중 setProcessor 실패 → 던지지 않고 'error'(graceful, R30)", async () => {
    const track = makeTrack();
    track.setProcessor.mockRejectedValue(new Error("gpu fail"));

    const outcome = await setCameraBlur(track, true, makeDeps());

    expect(outcome).toBe("error");
  });

  it("끄기 중 stopProcessor 실패 → 던지지 않고 'error'(graceful, R30)", async () => {
    const track = makeTrack();
    track.stopProcessor.mockRejectedValue(new Error("teardown fail"));

    const outcome = await setCameraBlur(track, false, makeDeps());

    expect(outcome).toBe("error");
  });
});
