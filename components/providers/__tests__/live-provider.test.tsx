import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

// LiveProvider 단위 테스트 — 브라우저 Supabase 채널을 모킹한다(AC).
// 검증: live.started→true / live.ended→false(broadcast 수신) + initialLive 초기 반영 + 키 부재 graceful.

type Handler = (message?: { payload?: Record<string, unknown> }) => void;
const handlers: Record<string, Handler> = {};
const removeChannelMock = vi.fn();
const subscriptions: Array<{ name: string; event: string; handler: Handler }> = [];
const statuses: Record<string, (status: string) => void> = {};
const server = new Map<string, { id: string } | null>();
const fetchMock = vi.fn();

const { createBrowserSupabaseMock } = vi.hoisted(() => ({
  createBrowserSupabaseMock: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: createBrowserSupabaseMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: () => fakeSupabase(),
}));

const { LiveProvider, useLive } = await import("@/components/providers/live-provider");
const { broadcastLive } = await import("@/lib/realtime");
const { AppProviders } = await import("@/components/providers/app-providers");

// 채널 빌더: .on(event)에서 핸들러를 캡처하고 .subscribe()는 자기 자신 반환.
function fakeSupabase() {
  return {
    channel(name: string) {
      const channel = {
        on(_t: string, opts: { event: string }, handler: Handler) {
          handlers[opts.event] = handler;
          subscriptions.push({ name, event: opts.event, handler });
          return channel;
        },
        subscribe(callback?: (status: string) => void) {
          if (callback) statuses[name] = callback;
          return channel;
        },
        async send(message: { event: string; payload: Record<string, unknown> }) {
          for (const sub of subscriptions) {
            if (sub.name === name && sub.event === message.event) {
              sub.handler({ payload: message.payload });
            }
          }
          return "ok";
        },
      };
      return channel;
    },
    removeChannel: removeChannelMock,
  };
}

function Probe({ id = "live" }: { id?: string }) {
  const { live, sessionId } = useLive();
  return <span data-testid={id} data-session-id={sessionId ?? ""}>{live ? "on" : "off"}</span>;
}

beforeEach(() => {
  vi.clearAllMocks();
  subscriptions.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
  for (const k of Object.keys(statuses)) delete statuses[k];
  server.clear();
  fetchMock.mockReset().mockImplementation(async (_url, init) => {
    const team = init?.headers?.["X-Hapark-Team-Id"];
    return Response.json({ data: server.get(team) ?? null });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("LiveProvider (Supabase Realtime)", () => {
  it("팀을 전환하면 이전 팀 상태를 비우고 새 팀의 전이만 반영한다", async () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    server.set("team-a", { id: "a" });
    const { rerender } = render(
      <AppProviders activeTeamId="team-a" initialLive>
        <Probe />
      </AppProviders>,
    );
    expect(screen.getByTestId("live")).toHaveTextContent("on");

    rerender(
      <AppProviders activeTeamId="team-b" initialLive={false}>
        <Probe />
      </AppProviders>,
    );
    expect(screen.getByTestId("live")).toHaveTextContent("off");
    server.set("team-b", { id: "b" });
    await act(async () => {
      await broadcastLive("live.started", { teamId: "team-a", sessionId: "a" });
    });
    expect(screen.getByTestId("live")).toHaveTextContent("off");
    await act(async () => {
      await broadcastLive("live.started", { teamId: "team-b", sessionId: "b" });
    });
    expect(screen.getByTestId("live")).toHaveTextContent("on");
  });

  it("다른 팀이 라이브를 종료해도 현재 팀 라이브는 유지된다", async () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    server.set("team-a", { id: "a" });
    server.set("team-b", { id: "b" });
    render(
      <>
        <LiveProvider teamId="team-a" initialLive>
          <Probe id="team-a" />
        </LiveProvider>
        <LiveProvider teamId="team-b" initialLive>
          <Probe id="team-b" />
        </LiveProvider>
      </>,
    );

    server.set("team-b", null);
    await act(async () => {
      await broadcastLive("live.ended", { teamId: "team-b", sessionId: "b" });
    });

    expect(screen.getByTestId("team-a")).toHaveTextContent("on");
    expect(screen.getByTestId("team-b")).toHaveTextContent("off");
  });

  it("live.started 수신 → live=true, live.ended → false", async () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());

    render(
      <LiveProvider teamId="team-a">
        <Probe />
      </LiveProvider>,
    );
    expect(screen.getByTestId("live").textContent).toBe("off");

    server.set("team-a", { id: "s1" });
    await act(async () => handlers["live.started"]({ payload: { teamId: "team-a", sessionId: "s1" } }));
    expect(screen.getByTestId("live").textContent).toBe("on");

    server.set("team-a", null);
    await act(async () => handlers["live.ended"]({ payload: { teamId: "team-a", sessionId: "s1" } }));
    expect(screen.getByTestId("live").textContent).toBe("off");
  });

  it("initialLive prop이 초기 상태에 반영된다", async () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    server.set("team-a", { id: "s1" });

    render(
      <LiveProvider teamId="team-a" initialLive>
        <Probe />
      </LiveProvider>,
    );
    expect(screen.getByTestId("live").textContent).toBe("on");
    await waitFor(() => expect(screen.getByTestId("live")).toHaveAttribute("data-session-id", "s1"));
  });

  it("키 부재(null) 시 구독 없이 graceful no-op", async () => {
    createBrowserSupabaseMock.mockReturnValue(null);

    expect(() =>
      render(
        <LiveProvider teamId="team-a">
          <Probe />
        </LiveProvider>,
      ),
    ).not.toThrow();
    expect(screen.getByTestId("live").textContent).toBe("off");
    await act(async () => {});
  });

  it("언마운트 시 removeChannel로 정리한다(재연결 폭주 방지)", () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());

    const { unmount } = render(
      <LiveProvider teamId="team-a">
        <Probe />
      </LiveProvider>,
    );
    unmount();
    expect(removeChannelMock).toHaveBeenCalled();
  });

  it("이전 세션의 늦은 종료 알림이 새 세션을 끄지 않는다", async () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    server.set("team-a", { id: "s2" });
    render(<LiveProvider teamId="team-a" initialLive><Probe /></LiveProvider>);
    await act(async () => handlers["live.started"]({ payload: { teamId: "team-a", sessionId: "s2" } }));

    await act(async () => handlers["live.ended"]({ payload: { teamId: "team-a", sessionId: "s1" } }));

    expect(screen.getByTestId("live")).toHaveTextContent("on");
    expect(screen.getByTestId("live")).toHaveAttribute("data-session-id", "s2");
  });

  it("같은 팀에서 갱신된 서버 props도 재검증해 놓친 종료를 복구한다", async () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    server.set("team-a", { id: "s1" });
    const { rerender } = render(<AppProviders activeTeamId="team-a" initialLive><Probe /></AppProviders>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    server.set("team-a", null);

    rerender(<AppProviders activeTeamId="team-a" initialLive={false}><Probe /></AppProviders>);

    await waitFor(() => expect(screen.getByTestId("live")).toHaveTextContent("off"));
  });

  it("Realtime 재구독 때 알림을 놓친 세션을 서버에서 복구한다", async () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    server.set("team-a", { id: "s1" });
    render(<LiveProvider teamId="team-a" initialLive><Probe /></LiveProvider>);
    await waitFor(() => expect(screen.getByTestId("live")).toHaveAttribute("data-session-id", "s1"));
    server.set("team-a", null);

    await act(async () => statuses["live:team-a"]?.("SUBSCRIBED"));

    expect(screen.getByTestId("live")).toHaveTextContent("off");
  });

  it.each(["online", "focus"])("%s 복귀 때 서버의 종료 상태를 반영한다", async (event) => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    server.set("team-a", { id: "s1" });
    render(<LiveProvider teamId="team-a" initialLive><Probe /></LiveProvider>);
    await waitFor(() => expect(screen.getByTestId("live")).toHaveAttribute("data-session-id", "s1"));
    server.set("team-a", null);

    await act(async () => window.dispatchEvent(new Event(event)));

    expect(screen.getByTestId("live")).toHaveTextContent("off");
  });

  it("늦게 도착한 재조회 응답이 더 최신 세션을 덮어쓰지 않는다", async () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    let resolveOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }));
    render(<LiveProvider teamId="team-a"><Probe /></LiveProvider>);
    server.set("team-a", { id: "s2" });
    await act(async () => handlers["live.started"]({ payload: { teamId: "team-a", sessionId: "s2" } }));

    await act(async () => resolveOld(Response.json({ data: { id: "s1" } })));

    expect(screen.getByTestId("live")).toHaveAttribute("data-session-id", "s2");
  });
});
