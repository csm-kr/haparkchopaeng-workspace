import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// PaperNotifyProvider 단위 테스트 — 브라우저 Supabase 채널을 모킹한다(live-provider와 동일 패턴).
// 검증: paper.analyzed 수신 → 구독 리스너 호출 + 전역 배너 / teamId·키 부재 graceful / provider 없이도 no-op.

type Msg = { payload?: { paperId: string; title: string } };
type Handler = (msg: Msg) => void;
const handlers: Record<string, Handler> = {};
const removeChannelMock = vi.fn();

const { createBrowserSupabaseMock } = vi.hoisted(() => ({
  createBrowserSupabaseMock: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: createBrowserSupabaseMock,
}));

const { PaperNotifyProvider, usePaperNotify } = await import(
  "@/components/providers/paper-notify-provider"
);

function fakeSupabase() {
  const channel = {
    on(_t: string, opts: { event: string }, cb: Handler) {
      handlers[opts.event] = cb;
      return channel;
    },
    subscribe() {
      return channel;
    },
  };
  return { channel: () => channel, removeChannel: removeChannelMock };
}

function Probe({
  onEvent,
}: {
  onEvent: (e: { paperId: string; title: string }) => void;
}) {
  const { onAnalyzed } = usePaperNotify();
  React.useEffect(() => onAnalyzed(onEvent), [onAnalyzed, onEvent]);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
});
afterEach(() => cleanup());

describe("PaperNotifyProvider", () => {
  it("paper.analyzed 수신 → 구독 리스너 호출 + 전역 배너(보기 링크) 노출", () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    const onEvent = vi.fn();
    render(
      <PaperNotifyProvider teamId="t1">
        <Probe onEvent={onEvent} />
      </PaperNotifyProvider>,
    );

    act(() =>
      handlers["paper.analyzed"]({
        payload: { paperId: "p1", title: "어떤 논문" },
      }),
    );

    expect(onEvent).toHaveBeenCalledWith({ paperId: "p1", title: "어떤 논문" });
    expect(screen.getByRole("status")).toHaveTextContent("어떤 논문");
    expect(screen.getByRole("link", { name: /보기/ })).toHaveAttribute(
      "href",
      "/papers/p1",
    );
  });

  it("teamId가 없으면 구독하지 않는다(graceful)", () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    render(
      <PaperNotifyProvider teamId={null}>
        <span>child</span>
      </PaperNotifyProvider>,
    );
    expect(handlers["paper.analyzed"]).toBeUndefined();
  });

  it("키 부재(null) 시 구독 없이 graceful no-op", () => {
    createBrowserSupabaseMock.mockReturnValue(null);
    expect(() =>
      render(
        <PaperNotifyProvider teamId="t1">
          <span>child</span>
        </PaperNotifyProvider>,
      ),
    ).not.toThrow();
  });

  it("언마운트 시 removeChannel로 정리한다", () => {
    createBrowserSupabaseMock.mockReturnValue(fakeSupabase());
    const { unmount } = render(
      <PaperNotifyProvider teamId="t1">
        <span>child</span>
      </PaperNotifyProvider>,
    );
    unmount();
    expect(removeChannelMock).toHaveBeenCalled();
  });

  it("provider 없이 usePaperNotify는 no-op을 반환한다(throw 금지)", () => {
    function Solo() {
      const { onAnalyzed } = usePaperNotify();
      onAnalyzed(() => {})(); // 등록 + 즉시 해지
      return <span data-testid="ok">ok</span>;
    }
    expect(() => render(<Solo />)).not.toThrow();
    expect(screen.getByTestId("ok")).toBeInTheDocument();
  });
});
