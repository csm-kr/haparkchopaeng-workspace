import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// MeetControls 단위 테스트 — 컨트롤 토글이 LiveKit 로컬 트랙 API를 부르는지(목).
// 화면공유는 발표자(grant 보유)에게만 노출(R7 — UI도 정직하게).

const lk = vi.hoisted(() => ({
  local: {
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    isScreenShareEnabled: false,
    setMicrophoneEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
    setScreenShareEnabled: vi.fn(),
  },
}));

vi.mock("@livekit/components-react", () => ({
  useLocalParticipant: () => ({
    isMicrophoneEnabled: lk.local.isMicrophoneEnabled,
    isCameraEnabled: lk.local.isCameraEnabled,
    isScreenShareEnabled: lk.local.isScreenShareEnabled,
    localParticipant: lk.local,
  }),
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
