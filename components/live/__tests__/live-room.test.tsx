import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// LiveRoom 단위 테스트 — 분기·권한·낙관적 전이(fetch 모킹).
// 검증: 라이브 없음→시작 / 발표자=자격증명+종료(확인) / 시청자=자격증명 미표시+나가기 / 409→입장.

// Realtime 구독은 graceful no-op로(키 부재). hls.js는 동적 import라 미지원 클래스로 모킹.
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => null }));
vi.mock("hls.js", () => ({
  default: class {
    static isSupported() {
      return false;
    }
  },
}));

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

beforeEach(() => vi.clearAllMocks());
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

  it("발표자: 시작 성공 → 자격증명(Stream Key) 표시 + [라이브 종료]는 확인 다이얼로그를 거친다", async () => {
    vi.stubGlobal(
      "fetch",
      route((url, method) => {
        if (url === "/api/live/start" && method === "POST")
          return res(201, {
            data: {
              session: { id: "s1", presenterId: "ha" },
              rtmps: { url: "rtmps://send/", streamKey: "KEY-12345" },
              srt: { url: "srt://send/", streamId: "sid", passphrase: "pass" },
              playback: { hls: "" },
            },
          });
        return res(500, {});
      }),
    );

    renderRoom({ currentMemberId: "ha", initialLive: false, initialSession: null });
    fireEvent.click(screen.getByRole("button", { name: /라이브 시작/ }));

    // 발표자 본인에게만 송출 자격증명 노출.
    expect(await screen.findByText("KEY-12345")).toBeInTheDocument();
    const endBtn = screen.getByRole("button", { name: /라이브 종료/ });
    expect(endBtn).toBeInTheDocument();

    // 종료는 파괴적(R27) — 즉시 실행하지 않고 확인 다이얼로그를 띄운다.
    fireEvent.click(endBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/모두의 세션이 끝나요/)).toBeInTheDocument();
  });

  it("시청자: 자격증명 미표시 + [나가기](전역 종료 아님) + join 호출", async () => {
    const fetchMock = route((url, method) => {
      if (url === "/api/live/s1/join" && method === "POST")
        return res(200, { data: { playback: { hls: "https://play/x.m3u8" } } });
      return res(500, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRoom({
      currentMemberId: "jo",
      initialLive: true,
      initialSession: { id: "s1", presenterId: "ha", participantIds: [] },
    });

    expect(
      await screen.findByRole("button", { name: /나가기/ }),
    ).toBeInTheDocument();
    // 송출 자격증명은 시청자에게 절대 보이지 않는다(SECURITY/R7).
    expect(screen.queryByText(/Stream Key/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /라이브 종료/ })).toBeNull();
    // 마운트 시 join 호출(시청 등록).
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/live/s1/join",
        expect.objectContaining({ method: "POST" }),
      ),
    );
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
});
