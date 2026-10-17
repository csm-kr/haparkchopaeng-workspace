import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../app-shell";

vi.mock("../sidebar", () => ({
  Sidebar: ({ collapsed, onToggleCollapse }: { collapsed: boolean; onToggleCollapse: () => void }) =>
    <aside data-testid="sidebar" data-collapsed={collapsed}><button onClick={onToggleCollapse}>사이드바 전환</button></aside>,
}));
const currentUser = { id: "me", name: "나", initial: "나", color: "var(--m-ha)", role: "멤버" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function media(initial: boolean) {
  let listener: ((event: { matches: boolean }) => void) | null = null;
  const query = {
    matches: initial,
    addEventListener: vi.fn((_event: string, callback: typeof listener) => { listener = callback; }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return { query, change(matches: boolean) { query.matches = matches; act(() => listener?.({ matches })); } };
}

describe("셸의 작은 화면", () => {
  it("767px 이하에서는 기존 접힌 레일로 시작하고 사용자가 펼칠 수 있다", () => {
    media(true);
    render(<AppShell members={[]} currentUser={currentUser}>본문</AppShell>);
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    fireEvent.click(screen.getByRole("button", { name: "사이드바 전환" }));
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
  });

  it("데스크톱은 펼쳐 시작하고 같은 화면 범위에서 사용자 선택을 유지한다", () => {
    media(false);
    render(<AppShell members={[]} currentUser={currentUser}>본문</AppShell>);
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
    fireEvent.click(screen.getByRole("button", { name: "사이드바 전환" }));
    fireEvent(window, new Event("resize"));
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
  });

  it("화면 경계를 넘을 때만 모드를 맞추고 구독을 정리한다", () => {
    const viewport = media(false);
    const { unmount } = render(<AppShell members={[]} currentUser={currentUser}>본문</AppShell>);
    viewport.change(true);
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    viewport.change(false);
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
    unmount();
    expect(viewport.query.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
