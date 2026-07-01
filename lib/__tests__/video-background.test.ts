import { describe, expect, it, vi } from "vitest";
import {
  applyCameraBackground,
  type BackgroundDeps,
  type BackgroundProcessorHandle,
} from "@/lib/video-background";

// lib/video-background.ts 단위 테스트 — 카메라 배경 선택(끄기/흐림/이미지)의 오케스트레이션.
// 실제 MediaPipe 세그멘테이션은 브라우저 GPU에서만 도므로 track-processors API는 주입(deps)으로 대체.
// 우리 코드의 분기만 검증한다: 최초 생성(setProcessor) vs 재사용(switchTo)·off 제거·게이팅·graceful 실패.

function makeTrack() {
  return {
    setProcessor: vi.fn().mockResolvedValue(undefined),
    stopProcessor: vi.fn().mockResolvedValue(undefined),
  };
}

function makeHandle(): BackgroundProcessorHandle {
  return { switchTo: vi.fn().mockResolvedValue(undefined) };
}

function makeDeps(overrides: Partial<BackgroundDeps> = {}): BackgroundDeps {
  return {
    isSupported: () => true,
    createProcessor: () => makeHandle(),
    ...overrides,
  };
}

describe("applyCameraBackground", () => {
  it("흐림 최초 적용(현재 없음) → 프로세서 생성 후 setProcessor, 'applied'", async () => {
    const track = makeTrack();
    const handle = makeHandle();
    const createProcessor = vi.fn(() => handle);
    const bg = { kind: "blur", radius: 16 } as const;

    const r = await applyCameraBackground(track, bg, null, makeDeps({ createProcessor }));

    expect(r.outcome).toBe("applied");
    expect(r.processor).toBe(handle);
    expect(createProcessor).toHaveBeenCalledWith(bg);
    expect(track.setProcessor).toHaveBeenCalledWith(handle);
    expect(handle.switchTo).not.toHaveBeenCalled();
  });

  it("흐림 변경(현재 있음) → 프로세서 재사용 switchTo(background-blur), setProcessor 미호출", async () => {
    const track = makeTrack();
    const current = makeHandle();

    const r = await applyCameraBackground(
      track,
      { kind: "blur", radius: 28 },
      current,
      makeDeps(),
    );

    expect(r.outcome).toBe("applied");
    expect(r.processor).toBe(current);
    expect(current.switchTo).toHaveBeenCalledWith({
      mode: "background-blur",
      blurRadius: 28,
    });
    expect(track.setProcessor).not.toHaveBeenCalled();
  });

  it("이미지 최초 적용(현재 없음) → 생성 후 setProcessor, 'applied'", async () => {
    const track = makeTrack();
    const handle = makeHandle();
    const createProcessor = vi.fn(() => handle);
    const bg = { kind: "image", path: "/backgrounds/hawaii.webp" } as const;

    const r = await applyCameraBackground(track, bg, null, makeDeps({ createProcessor }));

    expect(r.outcome).toBe("applied");
    expect(createProcessor).toHaveBeenCalledWith(bg);
    expect(track.setProcessor).toHaveBeenCalledWith(handle);
  });

  it("이미지 변경(현재 있음) → switchTo(virtual-background, imagePath)", async () => {
    const track = makeTrack();
    const current = makeHandle();

    const r = await applyCameraBackground(
      track,
      { kind: "image", path: "/backgrounds/sky.webp" },
      current,
      makeDeps(),
    );

    expect(r.outcome).toBe("applied");
    expect(current.switchTo).toHaveBeenCalledWith({
      mode: "virtual-background",
      imagePath: "/backgrounds/sky.webp",
    });
    expect(track.setProcessor).not.toHaveBeenCalled();
  });

  it("끄기(현재 있음) → stopProcessor로 제거, 'removed'·processor=null", async () => {
    const track = makeTrack();
    const current = makeHandle();

    const r = await applyCameraBackground(track, { kind: "off" }, current, makeDeps());

    expect(r.outcome).toBe("removed");
    expect(r.processor).toBeNull();
    expect(track.stopProcessor).toHaveBeenCalledOnce();
    expect(track.setProcessor).not.toHaveBeenCalled();
  });

  it("끄기(현재 없음) → 붙은 게 없으니 stopProcessor 미호출, 'removed'", async () => {
    const track = makeTrack();

    const r = await applyCameraBackground(track, { kind: "off" }, null, makeDeps());

    expect(r.outcome).toBe("removed");
    expect(r.processor).toBeNull();
    expect(track.stopProcessor).not.toHaveBeenCalled();
  });

  it("미지원 + 흐림 → 'unsupported', 현재 유지·아무 것도 붙이지 않음", async () => {
    const track = makeTrack();
    const current = makeHandle();
    const createProcessor = vi.fn(() => makeHandle());

    const r = await applyCameraBackground(
      track,
      { kind: "blur", radius: 16 },
      current,
      makeDeps({ isSupported: () => false, createProcessor }),
    );

    expect(r.outcome).toBe("unsupported");
    expect(r.processor).toBe(current);
    expect(createProcessor).not.toHaveBeenCalled();
    expect(track.setProcessor).not.toHaveBeenCalled();
    expect(current.switchTo).not.toHaveBeenCalled();
  });

  it("트랙 없음(카메라 꺼짐) → 'no-track', 현재 유지", async () => {
    const current = makeHandle();
    const r = await applyCameraBackground(null, { kind: "blur", radius: 16 }, current, makeDeps());
    expect(r.outcome).toBe("no-track");
    expect(r.processor).toBe(current);
  });

  it("최초 적용 중 setProcessor 실패 → 던지지 않고 'error'(graceful, R30)", async () => {
    const track = makeTrack();
    track.setProcessor.mockRejectedValue(new Error("gpu fail"));

    const r = await applyCameraBackground(track, { kind: "blur", radius: 16 }, null, makeDeps());

    expect(r.outcome).toBe("error");
  });

  it("변경 중 switchTo 실패 → 던지지 않고 'error'", async () => {
    const track = makeTrack();
    const current = makeHandle();
    (current.switchTo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("switch fail"));

    const r = await applyCameraBackground(track, { kind: "blur", radius: 8 }, current, makeDeps());

    expect(r.outcome).toBe("error");
  });

  it("끄기 중 stopProcessor 실패 → 던지지 않고 'error'", async () => {
    const track = makeTrack();
    track.stopProcessor.mockRejectedValue(new Error("teardown fail"));
    const current = makeHandle();

    const r = await applyCameraBackground(track, { kind: "off" }, current, makeDeps());

    expect(r.outcome).toBe("error");
  });
});
