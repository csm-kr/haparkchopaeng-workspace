import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

// LiveRoom 단위 테스트 — LiveKit 다자간 화상(ADR-019)으로 재작성.
// 검증: 라이브 없음→시작 / 발표자=룸 진입+종료(확인) / 시청자=join+나가기 / 409→입장 / 503 사유 /
//       참가자 타일(카메라=비디오, 미카메라=아바타).
//
// CRITICAL: livekit-client·@livekit/components-react는 가짜로(실제 WebSocket 연결 금지).
//   참가자/트랙은 테스트가 lk.* 로 주입한다.

const lk = vi.hoisted(() => ({
  participants: [] as Array<{
    identity: string;
    name?: string;
    isSpeaking?: boolean;
    isLocal?: boolean;
  }>,
  tracks: [] as Array<{
    participant: { identity: string };
    source: string;
    publication?: unknown;
  }>,
}));

vi.mock("livekit-client", () => ({
  Track: {
    Source: {
      Camera: "camera",
      ScreenShare: "screen_share",
      Microphone: "microphone",
      ScreenShareAudio: "screen_share_audio",
    },
  },
}));

vi.mock("@livekit/components-react", async () => {
  const React = await import("react");
  return {
    // 토큰으로 룸 컨텍스트를 제공하는 척만 한다 — 접속되면 onConnected를 부른다.
    LiveKitRoom: ({
      children,
      onConnected,
    }: {
      children: React.ReactNode;
      onConnected?: () => void;
    }) => {
      React.useEffect(() => {
        onConnected?.();
      }, [onConnected]);
      return React.createElement("div", { "data-testid": "livekit-room" }, children);
    },
    RoomAudioRenderer: () => null,
    VideoTrack: ({
      trackRef,
    }: {
      trackRef?: { participant?: { identity?: string } };
    }) =>
      React.createElement("div", {
        "data-testid": "video-tile",
        "data-identity": trackRef?.participant?.identity,
      }),
    useParticipants: () => lk.participants,
    useTracks: () => lk.tracks,
    // 컨트롤바·채팅(MeetRoom/MeetControls)이 쓰는 훅 — 실제 연결 없이 no-op 목.
    useRoomContext: () => ({ localParticipant: { publishData: vi.fn() } }),
    useLocalParticipant: () => ({
      isMicrophoneEnabled: false,
      isCameraEnabled: false,
      isScreenShareEnabled: false,
      localParticipant: {
        setMicrophoneEnabled: vi.fn(),
        setCameraEnabled: vi.fn(),
        setScreenShareEnabled: vi.fn(),
      },
    }),
    useDataChannel: () => ({ send: vi.fn(), message: undefined, isSending: false }),
  };
});

// Realtime 구독은 graceful no-op(키 부재).
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => null }));

const { LiveProvider } = await import("@/components/providers/live-provider");
const { LiveRoom } = await import("@/components/live/live-room");

const members = [
  { id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)" },
  { id: "jo", name: "조성민", initial: "조", color: "var(--m-jo)" },
];

interface MockRes {
  ok: boolean;
  status: number;
  body: unknown;
}
function res(status: number, body: unknown): MockRes {
  return { ok: status >= 200 && status < 300, status, body };
}
/** url+method로 분기하는 fetch 모킹. */
function route(map: (url: string, method: string) => MockRes) {
  return vi.fn(async (input: string, init?: { method?: string }) => {
    const m = map(input, init?.method ?? "GET");
    return { ok: m.ok, status: m.status, json: async () => m.body };
  });
}

function renderRoom(props: {
  currentMemberId: string;
  initialLive: boolean;
  initialSession: {
    id: string;
    presenterId: string;
    participantIds: string[];
  } | null;
}) {
  return render(
    <LiveProvider initialLive={props.initialLive}>
      <LiveRoom
        currentMemberId={props.currentMemberId}
        initialSession={props.initialSession}
        members={members}
      />
    </LiveProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  lk.participants = [];
  lk.tracks = [];
});
afterEach(() => cleanup());

describe("LiveRoom", () => {
  it("라이브 없음 → 빈 카피 + [라이브 시작] 노출", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderRoom({ currentMemberId: "ha", initialLive: false, initialSession: null });

    expect(screen.getByText(/아직 진행 중인 세미나가 없어요/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /라이브 시작/ }),
    ).toBeInTheDocument();
  });

  it("발표자: 시작 성공 → LiveKit 룸 진입 + [라이브 종료]는 확인 다이얼로그를 거친다", async () => {
    vi.stubGlobal(
      "fetch",
      route((url, method) => {
        if (url === "/api/live/start" && method === "POST")
          return res(201, {
            data: {
              session: {
                id: "s1",
                presenterId: "ha",
                startedAt: "2026-06-15T01:00:00Z",
              },
              token: "TKN-presenter",
              url: "wss://lk.example",
            },
          });
        return res(500, {});
      }),
    );

    renderRoom({ currentMemberId: "ha", initialLive: false, initialSession: null });
    fireEvent.click(screen.getByRole("button", { name: /라이브 시작/ }));

    // 토큰으로 LiveKit 룸 컨텍스트에 진입한다.
    expect(await screen.findByTestId("livekit-room")).toBeInTheDocument();
    // 송출 자격증명(Stream Key 등)은 더 이상 노출하지 않는다(LiveKit 토큰만).
    expect(screen.queryByText(/Stream Key/i)).not.toBeInTheDocument();

    const endBtn = screen.getByRole("button", { name: /라이브 종료/ });
    // 종료는 파괴적(R27) — 즉시 실행하지 않고 확인 다이얼로그를 띄운다.
    fireEvent.click(endBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/모두의 세션이 끝나요/)).toBeInTheDocument();
  });

  it("시작 시 미설정(503) → 서버의 친절한 사유를 그대로 노출(R30)", async () => {
    vi.stubGlobal(
      "fetch",
      route((url, method) => {
        if (url === "/api/live/start" && method === "POST")
          return res(503, {
            error: {
              code: "LIVE_UNCONFIGURED",
              message: "세미나 라이브가 아직 연결되지 않았어요.",
            },
          });
        return res(500, {});
      }),
    );

    renderRoom({ currentMemberId: "ha", initialLive: false, initialSession: null });
    fireEvent.click(screen.getByRole("button", { name: /라이브 시작/ }));

    expect(
      await screen.findByText(/세미나 라이브가 아직 연결되지 않았어요/),
    ).toBeInTheDocument();
  });

  it("시작 시 이미 진행 중(409) → 충돌이 아니라 입장으로 안내", async () => {
    vi.stubGlobal(
      "fetch",
      route((url, method) => {
        if (url === "/api/live/start" && method === "POST")
          return res(409, { error: { code: "CONFLICT", message: "x" } });
        return res(500, {});
      }),
    );

    renderRoom({ currentMemberId: "jo", initialLive: false, initialSession: null });
    fireEvent.click(screen.getByRole("button", { name: /라이브 시작/ }));

    expect(
      await screen.findByText(/이미 라이브가 진행 중이에요/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /입장/ })).toBeInTheDocument();
  });

  it("시청자: join 호출 + 룸 진입(자격증명 미표시) + [나가기]는 본인만 퇴장", async () => {
    const fetchMock = route((url, method) => {
      if (url === "/api/live/s1/join" && method === "POST")
        return res(200, { data: { token: "TKN-viewer", url: "wss://lk.example" } });
      if (url === "/api/live/s1/leave" && method === "POST") return res(200, {});
      return res(500, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRoom({
      currentMemberId: "jo",
      initialLive: true,
      initialSession: { id: "s1", presenterId: "ha", participantIds: [] },
    });

    // 마운트 시 join 호출(시청 등록 + 토큰).
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live/s1/join",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    // 토큰으로 룸 컨텍스트에 진입한다.
    expect(await screen.findByTestId("livekit-room")).toBeInTheDocument();
    // 종료(전역)는 발표자만 — 시청자에겐 없다(R6).
    expect(
      screen.queryByRole("button", { name: /라이브 종료/ }),
    ).toBeNull();

    // 나가기 = 확인 다이얼로그를 거쳐 본인만 퇴장.
    fireEvent.click(screen.getByRole("button", { name: "나가기" }));
    // 즉시 나가지 않는다 — 확인을 먼저 띄운다.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/라이브에서 나갈까요/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/live/s1/leave",
      expect.objectContaining({ method: "POST" }),
    );

    // 확인하면 /leave 호출.
    fireEvent.click(screen.getByRole("button", { name: "나갈게요" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live/s1/leave",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("시청자 나가기: 취소하면 룸에 그대로 남는다(퇴장 안 함)", async () => {
    const fetchMock = route((url, method) => {
      if (url === "/api/live/s1/join" && method === "POST")
        return res(200, { data: { token: "TKN-viewer", url: "wss://lk.example" } });
      if (url === "/api/live/s1/leave" && method === "POST") return res(200, {});
      return res(500, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRoom({
      currentMemberId: "jo",
      initialLive: true,
      initialSession: { id: "s1", presenterId: "ha", participantIds: [] },
    });
    expect(await screen.findByTestId("livekit-room")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "나가기" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    // 다이얼로그가 닫히고, /leave는 호출되지 않으며, 룸에 그대로 남는다.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/live/s1/leave",
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.getByTestId("livekit-room")).toBeInTheDocument();
  });

  it("참가자 타일: 카메라 트랙이 있으면 비디오, 없으면 아바타(이니셜)", async () => {
    lk.participants = [
      { identity: "ha", name: "하수현", isSpeaking: false },
      { identity: "jo", name: "조성민", isSpeaking: false, isLocal: true },
    ];
    // ha만 카메라 트랙을 publish 중.
    lk.tracks = [
      { participant: { identity: "ha" }, source: "camera", publication: {} },
    ];

    vi.stubGlobal(
      "fetch",
      route((url, method) => {
        if (url === "/api/live/s1/join" && method === "POST")
          return res(200, { data: { token: "TKN-viewer", url: "wss://lk.example" } });
        return res(500, {});
      }),
    );

    renderRoom({
      currentMemberId: "jo",
      initialLive: true,
      initialSession: { id: "s1", presenterId: "ha", participantIds: [] },
    });

    // 카메라 켠 ha → 비디오 타일.
    const video = await screen.findByTestId("video-tile");
    expect(video).toHaveAttribute("data-identity", "ha");
    // 카메라 끈 jo → 아바타(이니셜).
    expect(screen.getByLabelText("조성민 아바타")).toBeInTheDocument();
    // ha는 비디오라 아바타가 아니다.
    expect(screen.queryByLabelText("하수현 아바타")).toBeNull();
  });
});
