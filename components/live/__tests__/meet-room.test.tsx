import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

// MeetRoom 통합 테스트 — 데이터 채널 송수신을 검증한다.
// 송신: publishData(encodeLiveMessage(...)). 수신: DataReceived→decodeLiveMessage→화면 반영.
// CRITICAL: 작성자는 LiveKit identity로 판별(payload author 미신뢰, R3). decode null이면 무시.

type Received = { payload: Uint8Array; from?: { identity: string } };

const lk = vi.hoisted(() => ({
  participants: [] as Array<{ identity: string; name?: string }>,
  tracks: [] as unknown[],
  onMessage: undefined as undefined | ((m: Received) => void),
  publishData: vi.fn(),
  local: {
    setMicrophoneEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
    setScreenShareEnabled: vi.fn(),
  },
}));

vi.mock("livekit-client", () => ({
  Track: { Source: { Camera: "camera", ScreenShare: "screen_share" } },
}));

vi.mock("@livekit/components-react", () => ({
  RoomAudioRenderer: () => null,
  VideoTrack: () => null,
  useParticipants: () => lk.participants,
  useTracks: () => lk.tracks,
  useRoomContext: () => ({ localParticipant: { publishData: lk.publishData } }),
  useLocalParticipant: () => ({
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    isScreenShareEnabled: false,
    localParticipant: lk.local,
  }),
  useDataChannel: (_topic: string, onMessage: (m: Received) => void) => {
    lk.onMessage = onMessage;
    return { send: vi.fn(), message: undefined, isSending: false };
  },
}));

const { MeetRoom } = await import("@/components/live/meet-room");
const { encodeLiveMessage, decodeLiveMessage } = await import(
  "@/lib/live-messages"
);

const members = [
  { id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)" },
  { id: "jo", name: "조성민", initial: "조", color: "var(--m-jo)" },
];

function renderRoom(opts?: {
  presenterId?: string;
  currentMemberId?: string;
  isPresenter?: boolean;
  presentations?: Array<{ id: string; title: string }>;
}) {
  return render(
    <MeetRoom
      members={members}
      presenterId={opts?.presenterId ?? "ha"}
      currentMemberId={opts?.currentMemberId ?? "jo"}
      isPresenter={opts?.isPresenter ?? false}
      presentations={opts?.presentations ?? []}
    />,
  );
}

function openChat() {
  fireEvent.click(screen.getByRole("button", { name: /채팅/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  lk.participants = [];
  lk.tracks = [];
  lk.onMessage = undefined;
});
afterEach(() => cleanup());

describe("MeetRoom", () => {
  it("채팅 전송 → publishData(encodeLiveMessage(chat)) 호출 + 본인 메시지 낙관적 표시", () => {
    renderRoom();
    openChat();

    const input = screen.getByPlaceholderText(/메시지/);
    fireEvent.change(input, { target: { value: "들립니다" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(lk.publishData).toHaveBeenCalledTimes(1);
    const [payload, opts] = lk.publishData.mock.calls[0] as [
      Uint8Array,
      { reliable?: boolean; topic?: string },
    ];
    expect(decodeLiveMessage(payload)).toMatchObject({
      kind: "chat",
      text: "들립니다",
    });
    expect(opts).toMatchObject({ reliable: true, topic: "live" });
    // 낙관적 UI — publishData는 본인에게 echo되지 않으므로 로컬에 즉시 반영
    expect(screen.getByText("들립니다")).toBeInTheDocument();
  });

  it("수신 채팅 → decodeLiveMessage → identity로 작성자 매핑해 표시(R3)", () => {
    renderRoom();
    openChat();

    act(() => {
      lk.onMessage?.({
        payload: encodeLiveMessage({ kind: "chat", text: "수신했어요", at: 1 }),
        from: { identity: "ha" },
      });
    });

    expect(screen.getByText("수신했어요")).toBeInTheDocument();
    expect(screen.getByText("하수현")).toBeInTheDocument();
  });

  it("decode 불가 메시지는 무시한다(빈 상태 유지)", () => {
    renderRoom();
    openChat();

    act(() => {
      lk.onMessage?.({
        payload: new Uint8Array([0, 1, 2, 3]),
        from: { identity: "ha" },
      });
    });

    expect(screen.getByText(/아직 채팅이 없어요/)).toBeInTheDocument();
  });

  it("수신 반응 → 플로팅 이모지가 떠오른다(허용 keyframe)", () => {
    const { container } = renderRoom();

    act(() => {
      lk.onMessage?.({
        payload: encodeLiveMessage({ kind: "reaction", emoji: "🎉", at: 1 }),
        from: { identity: "ha" },
      });
    });

    const floats = container.querySelectorAll("[data-reaction]");
    expect(floats).toHaveLength(1);
    expect(floats[0].textContent).toBe("🎉");
  });
});

describe("MeetRoom 발표자료 공유", () => {
  it("발표자 identity의 present 수신 → 슬라이드 무대로 전환(R3 신뢰)", () => {
    lk.participants = [{ identity: "ha" }, { identity: "jo" }];
    const { container } = renderRoom({ presenterId: "ha", currentMemberId: "jo" });

    act(() => {
      lk.onMessage?.({
        payload: encodeLiveMessage({
          kind: "present",
          presentationId: "pres-1",
          page: 1,
          pageCount: 3,
          at: 1,
        }),
        from: { identity: "ha" }, // 발표자
      });
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/api/presentations/pres-1/pages/1",
    );
  });

  it("비-발표자가 위조한 present는 무시한다(R3)", () => {
    lk.participants = [{ identity: "ha" }, { identity: "jo" }];
    const { container } = renderRoom({ presenterId: "ha", currentMemberId: "jo" });

    act(() => {
      lk.onMessage?.({
        payload: encodeLiveMessage({
          kind: "present",
          presentationId: "evil",
          page: 1,
          pageCount: 3,
          at: 1,
        }),
        from: { identity: "jo" }, // 발표자 아님
      });
    });

    expect(container.querySelector("img")).toBeNull();
  });

  it("발표자가 자료를 공유하면 /pages로 페이지 수를 받아 present를 publish한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { count: 5 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    lk.participants = [{ identity: "jo" }];

    renderRoom({
      presenterId: "jo",
      currentMemberId: "jo",
      isPresenter: true,
      presentations: [{ id: "pres-1", title: "MoD 세미나" }],
    });

    // 컨트롤바의 '발표자료 공유' → 자료 패널 열림 → 목록의 '공유'
    fireEvent.click(screen.getByRole("button", { name: "발표자료 공유" }));
    fireEvent.click(await screen.findByRole("button", { name: "공유" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/presentations/pres-1/pages"),
    );
    await waitFor(() => {
      const presentCalls = lk.publishData.mock.calls.filter(
        ([p]) => decodeLiveMessage(p as Uint8Array)?.kind === "present",
      );
      expect(presentCalls.length).toBeGreaterThanOrEqual(1);
      expect(decodeLiveMessage(presentCalls[0][0] as Uint8Array)).toMatchObject({
        kind: "present",
        presentationId: "pres-1",
        page: 1,
        pageCount: 5,
      });
    });

    vi.unstubAllGlobals();
  });

  it("발표자료 공유 버튼은 발표자에게만 보인다(R7)", () => {
    const { rerender } = renderRoom({
      presenterId: "jo",
      currentMemberId: "jo",
      isPresenter: true,
      presentations: [{ id: "pres-1", title: "MoD" }],
    });
    expect(
      screen.getByRole("button", { name: "발표자료 공유" }),
    ).toBeInTheDocument();

    rerender(
      <MeetRoom
        members={members}
        presenterId="ha"
        currentMemberId="jo"
        isPresenter={false}
        presentations={[{ id: "pres-1", title: "MoD" }]}
      />,
    );
    expect(screen.queryByRole("button", { name: "발표자료 공유" })).toBeNull();
  });
});
