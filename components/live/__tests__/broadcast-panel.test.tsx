import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// BroadcastPanel 단위 테스트 — 화면+마이크 캡처 → WHIP publish를 모킹해 검증한다.
// getDisplayMedia/getUserMedia/publishWhip을 모킹(브라우저 없이).

const { publishWhipMock } = vi.hoisted(() => ({ publishWhipMock: vi.fn() }));
vi.mock("@/lib/whip", () => ({ publishWhip: publishWhipMock }));

const { BroadcastPanel } = await import("@/components/live/broadcast-panel");

function fakeTrack(kind: "video" | "audio") {
  return {
    kind,
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function fakeStream(tracks: ReturnType<typeof fakeTrack>[]) {
  const list = [...tracks];
  return {
    getTracks: () => list,
    getVideoTracks: () => list.filter((t) => t.kind === "video"),
    getAudioTracks: () => list.filter((t) => t.kind === "audio"),
    addTrack: (t: ReturnType<typeof fakeTrack>) => list.push(t),
  };
}

function setMediaDevices(devices: {
  getDisplayMedia: () => Promise<unknown>;
  getUserMedia: () => Promise<unknown>;
}) {
  Object.defineProperty(navigator, "mediaDevices", {
    value: devices,
    configurable: true,
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("BroadcastPanel", () => {
  it("webRTC URL이 있으면 송출 시작 → 화면+마이크 캡처 후 publishWhip 호출, '송출 중' 표시", async () => {
    const getDisplayMedia = vi.fn(async () => fakeStream([fakeTrack("video")]));
    const getUserMedia = vi.fn(async () => fakeStream([fakeTrack("audio")]));
    setMediaDevices({ getDisplayMedia, getUserMedia });
    publishWhipMock.mockResolvedValue({ stop: vi.fn() });

    render(<BroadcastPanel webRTCUrl="https://whip/publish" />);
    fireEvent.click(screen.getByRole("button", { name: /송출 시작/ }));

    expect(await screen.findByText(/송출 중/)).toBeInTheDocument();
    expect(getDisplayMedia).toHaveBeenCalled();
    expect(publishWhipMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://whip/publish" }),
    );
  });

  it("화면 공유 권한 거부 시 친절 안내 + publishWhip 미호출", async () => {
    const getDisplayMedia = vi.fn(async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    });
    setMediaDevices({ getDisplayMedia, getUserMedia: vi.fn() });

    render(<BroadcastPanel webRTCUrl="https://whip/publish" />);
    fireEvent.click(screen.getByRole("button", { name: /송출 시작/ }));

    expect(await screen.findByText(/권한/)).toBeInTheDocument();
    expect(publishWhipMock).not.toHaveBeenCalled();
  });

  it("webRTC URL이 없으면 송출 시작 버튼 대신 안내만 노출(브라우저 송출 불가)", () => {
    render(<BroadcastPanel webRTCUrl={null} />);
    expect(screen.queryByRole("button", { name: /송출 시작/ })).toBeNull();
    expect(screen.getByText(/브라우저 송출/)).toBeInTheDocument();
  });

  it("언마운트되면 송출 세션을 정리한다(stop)", async () => {
    const stop = vi.fn();
    setMediaDevices({
      getDisplayMedia: vi.fn(async () => fakeStream([fakeTrack("video")])),
      getUserMedia: vi.fn(async () => fakeStream([fakeTrack("audio")])),
    });
    publishWhipMock.mockResolvedValue({ stop });

    const view = render(<BroadcastPanel webRTCUrl="https://whip/publish" />);
    fireEvent.click(screen.getByRole("button", { name: /송출 시작/ }));
    await screen.findByText(/송출 중/);

    view.unmount();
    expect(stop).toHaveBeenCalled();
  });
});
