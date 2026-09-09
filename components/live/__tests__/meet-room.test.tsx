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
  sendFile: vi.fn(),
  registerByteStreamHandler: vi.fn(),
  unregisterByteStreamHandler: vi.fn(),
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
  useRoomContext: () => ({
    localParticipant: { publishData: lk.publishData, sendFile: lk.sendFile },
    registerByteStreamHandler: lk.registerByteStreamHandler,
    unregisterByteStreamHandler: lk.unregisterByteStreamHandler,
  }),
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

  it("컨트롤바에서 '내 얼굴'을 누르면 무대에서 내 타일이 사라진다", () => {
    lk.participants = [{ identity: "ha" }, { identity: "jo" }];
    const { container } = renderRoom({ currentMemberId: "jo" });
    expect(container.querySelector('[data-identity="jo"]')).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "내 화면에서 내 얼굴 숨기기" }),
    );

    expect(container.querySelector('[data-identity="jo"]')).toBeNull();
    expect(container.querySelector('[data-identity="ha"]')).not.toBeNull();
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

// ── 채팅 이미지(휘발) ────────────────────────────────────────────────
// CRITICAL: 이미지는 서버를 거치지 않는다(R21) — LiveKit 바이트 스트림으로 룸 참가자에게 직접 간다.
// CRITICAL: 보낸 사람은 스트림의 participantInfo.identity로 판별한다 — 페이로드 미신뢰(R3).
// CRITICAL: blob URL은 룸을 떠날 때 해제한다 — 오래 켜 두면 그대로 쌓인다.

const IMAGE_TOPIC = "live-image";

/** 등록된 바이트 스트림 핸들러를 꺼낸다(해당 토픽만). */
function byteHandler() {
  const call = lk.registerByteStreamHandler.mock.calls.find(
    (c) => c[0] === IMAGE_TOPIC,
  );
  return call?.[1] as
    | ((
        reader: {
          readAll: () => Promise<Uint8Array[]>;
          info: { mimeType: string };
        },
        info: { identity: string },
      ) => void)
    | undefined;
}

function attachImage(file: File) {
  const input = screen.getByLabelText("이미지 첨부") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("MeetRoom 채팅 이미지", () => {
  beforeEach(() => {
    let n = 0;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:img-${++n}`),
      revokeObjectURL: vi.fn(),
    });
  });

  it("이미지를 첨부하면 바이트 스트림으로 보낸다(서버 경유 없음)", async () => {
    renderRoom();
    openChat();
    const file = new File(["bytes"], "shot.png", { type: "image/png" });
    attachImage(file);

    await waitFor(() =>
      expect(lk.sendFile).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ topic: IMAGE_TOPIC }),
      ),
    );
  });

  it("내가 보낸 이미지는 내 화면에도 바로 보인다(스트림은 본인에게 안 돌아온다)", async () => {
    renderRoom({ currentMemberId: "jo" });
    openChat();
    attachImage(new File(["bytes"], "shot.png", { type: "image/png" }));

    expect(await screen.findByAltText("조성민 님이 보낸 이미지")).toBeInTheDocument();
  });

  it("다른 참가자가 보낸 이미지를 받아 채팅에 그린다 — 작성자는 identity로 판별(R3)", async () => {
    renderRoom({ currentMemberId: "jo" });
    openChat();

    const handler = byteHandler();
    expect(handler).toBeTypeOf("function");

    await act(async () => {
      handler!(
        {
          readAll: async () => [new Uint8Array([1, 2, 3])],
          info: { mimeType: "image/png" },
        },
        { identity: "ha" },
      );
    });

    expect(await screen.findByAltText("하수현 님이 보낸 이미지")).toBeInTheDocument();
  });

  it("이미지가 아닌 파일은 스트림을 열지 않는다", () => {
    renderRoom();
    openChat();
    attachImage(new File(["x"], "paper.pdf", { type: "application/pdf" }));
    expect(lk.sendFile).not.toHaveBeenCalled();
  });

  it("룸을 떠나면 핸들러를 풀고 만든 blob URL을 해제한다", async () => {
    const { unmount } = renderRoom({ currentMemberId: "jo" });
    openChat();
    attachImage(new File(["bytes"], "shot.png", { type: "image/png" }));
    await screen.findByAltText("조성민 님이 보낸 이미지");

    const revoke = (globalThis.URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> })
      .revokeObjectURL;
    unmount();

    expect(lk.unregisterByteStreamHandler).toHaveBeenCalledWith(IMAGE_TOPIC);
    expect(revoke).toHaveBeenCalledWith("blob:img-1");
  });
});
