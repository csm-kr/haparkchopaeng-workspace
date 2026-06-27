import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

// MeetControls 단위 테스트 — 컨트롤 토글이 LiveKit 로컬 트랙 API를 부르는지(목).
// 화면공유는 발표자(grant 보유)에게만 노출(R7 — UI도 정직하게).
// 배경 흐림은 카메라 트랙에 track-processor를 붙였다 뗐다 한다(미지원/카메라 꺼짐은 따뜻한 안내, R30).

const lk = vi.hoisted(() => ({
  local: {
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    isScreenShareEnabled: false,
    setMicrophoneEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
    setScreenShareEnabled: vi.fn(),
  },
  // 로컬 카메라 트랙(publication.track) — 배경 흐림 프로세서를 붙이는 대상.
  camTrack: {
    setProcessor: vi.fn(),
    stopProcessor: vi.fn(),
  },
  // useLocalParticipant().cameraTrack(publication). 카메라 꺼짐이면 null.
  cameraPublication: null as { track: unknown } | null,
  // 브라우저가 배경 프로세서를 지원하는지.
  supported: true,
}));

vi.mock("@livekit/components-react", () => ({
  useLocalParticipant: () => ({
    isMicrophoneEnabled: lk.local.isMicrophoneEnabled,
    isCameraEnabled: lk.local.isCameraEnabled,
    isScreenShareEnabled: lk.local.isScreenShareEnabled,
    cameraTrack: lk.cameraPublication ?? undefined,
    localParticipant: lk.local,
  }),
}));

vi.mock("@livekit/track-processors", () => ({
  supportsBackgroundProcessors: () => lk.supported,
  BackgroundProcessor: () => ({ name: "blur" }),
}));

const { MeetControls } = await import("@/components/live/meet-controls");

function renderControls(
  overrides: Partial<React.ComponentProps<typeof MeetControls>> = {},
) {
  return render(
    <MeetControls
      canScreenShare={true}
      canPresent={true}
      presenting={false}
      handUp={false}
      panelOpen={false}
      onToggleHand={vi.fn()}
      onReact={vi.fn()}
      onTogglePanel={vi.fn()}
      onOpenPresent={vi.fn()}
      onStopPresent={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  lk.local.isMicrophoneEnabled = false;
  lk.local.isCameraEnabled = false;
  lk.local.isScreenShareEnabled = false;
  lk.cameraPublication = { track: lk.camTrack };
  lk.supported = true;
});
afterEach(() => cleanup());

describe("MeetControls", () => {
  it("마이크 토글 → setMicrophoneEnabled(true)", () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /마이크/ }));
    expect(lk.local.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  });

  it("카메라 토글 → setCameraEnabled(true)", () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /카메라/ }));
    expect(lk.local.setCameraEnabled).toHaveBeenCalledWith(true);
  });

  it("발표자: 화면공유 토글 → setScreenShareEnabled(true)", () => {
    renderControls({ canScreenShare: true });
    fireEvent.click(screen.getByRole("button", { name: /화면 공유/ }));
    expect(lk.local.setScreenShareEnabled).toHaveBeenCalledWith(true);
  });

  it("시청자(grant 없음): 화면공유 버튼이 보이지 않는다(R7)", () => {
    renderControls({ canScreenShare: false });
    expect(
      screen.queryByRole("button", { name: /화면 공유/ }),
    ).toBeNull();
  });

  it("반응 클릭 → onReact(emoji)", () => {
    const onReact = vi.fn();
    renderControls({ onReact });
    fireEvent.click(screen.getByRole("button", { name: "🔥" }));
    expect(onReact).toHaveBeenCalledWith("🔥");
  });

  it("손들기 클릭 → onToggleHand", () => {
    const onToggleHand = vi.fn();
    renderControls({ onToggleHand });
    fireEvent.click(screen.getByRole("button", { name: /손들기/ }));
    expect(onToggleHand).toHaveBeenCalled();
  });

  it("채팅 클릭 → onTogglePanel", () => {
    const onTogglePanel = vi.fn();
    renderControls({ onTogglePanel });
    fireEvent.click(screen.getByRole("button", { name: /채팅/ }));
    expect(onTogglePanel).toHaveBeenCalled();
  });

  it("발표자: 발표자료 공유 클릭 → onOpenPresent", () => {
    const onOpenPresent = vi.fn();
    renderControls({ canPresent: true, presenting: false, onOpenPresent });
    fireEvent.click(screen.getByRole("button", { name: "발표자료 공유" }));
    expect(onOpenPresent).toHaveBeenCalled();
  });

  it("공유 중이면 버튼이 '공유 중지' → onStopPresent", () => {
    const onStopPresent = vi.fn();
    renderControls({ canPresent: true, presenting: true, onStopPresent });
    fireEvent.click(screen.getByRole("button", { name: "발표자료 공유 중지" }));
    expect(onStopPresent).toHaveBeenCalled();
  });

  it("시청자(발표자 아님): 발표자료 공유 버튼이 보이지 않는다(R7)", () => {
    renderControls({ canPresent: false });
    expect(
      screen.queryByRole("button", { name: /발표자료 공유/ }),
    ).toBeNull();
  });
});

describe("MeetControls 배경 흐림", () => {
  it("배경 흐림 버튼이 누구에게나 보인다", () => {
    renderControls({ canScreenShare: false, canPresent: false });
    expect(
      screen.getByRole("button", { name: /배경 흐림/ }),
    ).toBeInTheDocument();
  });

  it("카메라 켜짐 + 배경 흐림 클릭 → 카메라 트랙에 setProcessor 적용", async () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /배경 흐림/ }));
    await waitFor(() =>
      expect(lk.camTrack.setProcessor).toHaveBeenCalledOnce(),
    );
    expect(lk.camTrack.stopProcessor).not.toHaveBeenCalled();
  });

  it("배경 흐림 켠 뒤 다시 클릭 → stopProcessor로 제거", async () => {
    renderControls();
    const btn = screen.getByRole("button", { name: /배경 흐림/ });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(lk.camTrack.setProcessor).toHaveBeenCalledOnce(),
    );
    fireEvent.click(screen.getByRole("button", { name: /배경 흐림/ }));
    await waitFor(() =>
      expect(lk.camTrack.stopProcessor).toHaveBeenCalledOnce(),
    );
  });

  it("카메라 꺼짐(트랙 없음): 클릭 시 안내 + setProcessor 미호출", async () => {
    lk.cameraPublication = null;
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /배경 흐림/ }));
    await waitFor(() =>
      expect(screen.getByText(/카메라를 먼저 켜/)).toBeInTheDocument(),
    );
    expect(lk.camTrack.setProcessor).not.toHaveBeenCalled();
  });

  it("미지원 브라우저: 클릭 시 안내 + setProcessor 미호출", async () => {
    lk.supported = false;
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /배경 흐림/ }));
    await waitFor(() =>
      expect(screen.getByText(/지원하지 않/)).toBeInTheDocument(),
    );
    expect(lk.camTrack.setProcessor).not.toHaveBeenCalled();
  });
});
