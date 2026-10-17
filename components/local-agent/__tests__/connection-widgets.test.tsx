import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuotaBadge } from "../quota-badge";
import { ConnectionDialog } from "../connection-dialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("작은 사용량 표시", () => {
  const windows = [
    { id: "5h", label: "5시간 구독 한도", remainingPercent: 62, resetsAt: "2026-10-17T09:00:00.000Z", observedAt: "2026-10-17T07:00:00.000Z", freshness: "fresh" as const },
    { id: "7d", label: "7일 한도", remainingPercent: null, resetsAt: null, observedAt: null, freshness: "unknown" as const },
  ];

  it("20px 링만 표시하고 상세는 호버·포커스할 때 보여 준다", () => {
    render(<QuotaBadge windows={windows} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getAllByTestId("usage-ring")).toHaveLength(2);
    expect(screen.getAllByTestId("usage-ring")[0]).toHaveAttribute("width", "20");
    const button = screen.getByRole("button", { name: "사용량 상세" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("62% 남음");
    expect(screen.getByRole("tooltip")).toHaveTextContent("정보를 제공하지 않아요");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("0%·미제공·이전 관측값을 구분하고 잔여 토큰으로 표현하지 않는다", () => {
    render(<QuotaBadge windows={[
      { ...windows[0], remainingPercent: 0, freshness: "stale" },
      windows[1],
    ]} />);
    fireEvent.focus(screen.getByRole("button", { name: "사용량 상세" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("0% 남음");
    expect(screen.getByRole("tooltip")).toHaveTextContent("이전 확인값");
    expect(screen.getByRole("tooltip")).toHaveTextContent("정확한 잔여 토큰 수를 의미하지 않아요");
    expect(screen.getAllByTestId("usage-ring")[1]).toHaveAttribute("data-state", "unknown");
    expect(screen.getAllByTestId("usage-ring")[0]).toHaveAttribute("data-state", "stale");
  });

  it("터치 환경에서는 탭으로 상세를 열고 닫는다", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<QuotaBadge windows={windows} />);
    const button = screen.getByRole("button", { name: "사용량 상세" });
    fireEvent.click(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("호버 중 새 사용량이 동기화되어도 상세를 유지한다", () => {
    const { rerender } = render(<QuotaBadge windows={windows} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "사용량 상세" }));
    rerender(<QuotaBadge windows={[{ ...windows[0], remainingPercent: 61 }, windows[1]]} />);
    expect(screen.getByRole("tooltip")).toHaveTextContent("61% 남음");
  });
});

describe("연결 모달 접근성", () => {
  it("열리면 포커스를 옮기고 Tab을 가두며 Escape 후 원래 버튼으로 돌아온다", () => {
    const close = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "AI 연결";
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<ConnectionDialog title="AI 연결" onClose={close}>
      <button type="button">연결기 열기</button>
      <button type="button">마지막 동작</button>
    </ConnectionDialog>);
    const dialog = screen.getByRole("dialog", { name: "AI 연결" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    const last = screen.getByRole("button", { name: "마지막 동작" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(screen.getByRole("button", { name: "연결창 닫기" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("취소처럼 포커스된 동작이 사라지면 연결창 안으로 포커스를 복구한다", () => {
    const { rerender } = render(<ConnectionDialog title="AI 연결" onClose={vi.fn()}>
      <button type="button">연결 취소</button>
    </ConnectionDialog>);
    screen.getByRole("button", { name: "연결 취소" }).focus();
    rerender(<ConnectionDialog title="AI 연결" onClose={vi.fn()}><p>연결을 취소했어요</p></ConnectionDialog>);
    expect(screen.getByRole("button", { name: "연결창 닫기" })).toHaveFocus();
  });

  it("포커스가 문서로 빠져도 Escape와 Tab이 연결창에서 처리된다", () => {
    const close = vi.fn();
    render(<ConnectionDialog title="AI 연결" onClose={close}><p>대기 중</p></ConnectionDialog>);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(screen.getByRole("button", { name: "연결창 닫기" })).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
