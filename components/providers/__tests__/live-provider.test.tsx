import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// LiveProvider 단위 테스트 — 브라우저 Supabase 채널을 모킹한다(AC).
// 검증: live.started→true / live.ended→false(broadcast 수신) + initialLive 초기 반영 + 키 부재 graceful.

type Handler = () => void;
const handlers: Record<string, Handler> = {};
const removeChannelMock = vi.fn();

const { createBrowserSupabaseMock } = vi.hoisted(() => ({
  createBrowserSupabaseMock: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: createBrowserSupabaseMock,
}));

const { LiveProvider, useLive } = await import("@/components/providers/live-provider");

// 채널 빌더: .on(event)에서 핸들러를 캡처하고 .subscribe()는 자기 자신 반환.
function fakeSupabase() {
  const channel: {
    on: (t: string, opts: { event: string }, cb: Handler) => typeof channel;
    subscribe: () => typeof channel;
  } = {
    on(_t, opts, cb) {
      handlers[opts.event] = cb;
      return channel;
    },
    subscribe() {
      return channel;
    },
  };
  return { channel: () => channel, removeChannel: removeChannelMock };
}

function Probe() {
  const { live } = useLive();
  return <span data-testid="live">{live ? "on" : "off"}</span>;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
});

afterEach(() => cleanup());

describe("LiveProvider (Supabase Realtime)", () => {
  it("live.started 수신 → live=true, live.ended → false", () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());

    render(
      <LiveProvider>
        <Probe />
      </LiveProvider>,
    );
    expect(screen.getByTestId("live").textContent).toBe("off");

    act(() => handlers["live.started"]());
    expect(screen.getByTestId("live").textContent).toBe("on");

    act(() => handlers["live.ended"]());
    expect(screen.getByTestId("live").textContent).toBe("off");
  });

  it("initialLive prop이 초기 상태에 반영된다", () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());

    render(
      <LiveProvider initialLive>
        <Probe />
      </LiveProvider>,
    );
    expect(screen.getByTestId("live").textContent).toBe("on");
  });

  it("키 부재(null) 시 구독 없이 graceful no-op", () => {
    createBrowserSupabaseMock.mockReturnValue(null);

    expect(() =>
      render(
        <LiveProvider>
          <Probe />
        </LiveProvider>,
      ),
    ).not.toThrow();
    expect(screen.getByTestId("live").textContent).toBe("off");
  });

  it("언마운트 시 removeChannel로 정리한다(재연결 폭주 방지)", () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());

    const { unmount } = render(
      <LiveProvider>
        <Probe />
      </LiveProvider>,
    );
    unmount();
    expect(removeChannelMock).toHaveBeenCalled();
  });
});
