import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// LiveProvider 단위 테스트 — 브라우저 Supabase 채널을 모킹한다(AC).
// 검증: live.started→true / live.ended→false(broadcast 수신) + initialLive 초기 반영 + 키 부재 graceful.

type Handler = (message?: { payload?: Record<string, unknown> }) => void;
const handlers: Record<string, Handler> = {};
const removeChannelMock = vi.fn();
const subscriptions: Array<{ name: string; event: string; handler: Handler }> = [];

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
        subscribe() {
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
  const { live } = useLive();
  return <span data-testid={id}>{live ? "on" : "off"}</span>;
}

beforeEach(() => {
  vi.clearAllMocks();
  subscriptions.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
});

afterEach(() => cleanup());

describe("LiveProvider (Supabase Realtime)", () => {
  it("팀을 전환하면 이전 팀 상태를 비우고 새 팀의 전이만 반영한다", async () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
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

    await act(async () => {
      await broadcastLive("live.ended", { teamId: "team-b", sessionId: "b" });
    });

    expect(screen.getByTestId("team-a")).toHaveTextContent("on");
    expect(screen.getByTestId("team-b")).toHaveTextContent("off");
  });

  it("live.started 수신 → live=true, live.ended → false", () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());

    render(
      <LiveProvider teamId="team-a">
        <Probe />
      </LiveProvider>,
    );
    expect(screen.getByTestId("live").textContent).toBe("off");

    act(() => handlers["live.started"]({ payload: { teamId: "team-a", sessionId: "s1" } }));
    expect(screen.getByTestId("live").textContent).toBe("on");

    act(() => handlers["live.ended"]({ payload: { teamId: "team-a", sessionId: "s1" } }));
    expect(screen.getByTestId("live").textContent).toBe("off");
  });

  it("initialLive prop이 초기 상태에 반영된다", () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());

    render(
      <LiveProvider teamId="team-a" initialLive>
        <Probe />
      </LiveProvider>,
    );
    expect(screen.getByTestId("live").textContent).toBe("on");
  });

  it("키 부재(null) 시 구독 없이 graceful no-op", () => {
    createBrowserSupabaseMock.mockReturnValue(null);

    expect(() =>
      render(
        <LiveProvider teamId="team-a">
          <Probe />
        </LiveProvider>,
      ),
    ).not.toThrow();
    expect(screen.getByTestId("live").textContent).toBe("off");
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
});
