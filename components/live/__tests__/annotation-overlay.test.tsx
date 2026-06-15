import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AnnotationOverlay,
  normalizePoint,
  type ActiveAnnotation,
} from "@/components/live/annotation-overlay";

// 화면공유 주석 오버레이 — 발표자만 그린다(R7). 좌표는 박스 기준 정규화. 펜=polyline, 레이저=circle.

afterEach(() => cleanup());

describe("normalizePoint", () => {
  it("박스 기준 0..1로 정규화하고 clamp한다", () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 };
    expect(normalizePoint(200, 100, rect)).toEqual([0.5, 0.5]);
    expect(normalizePoint(0, 0, rect)).toEqual([0, 0]); // 음수 → 0
    expect(normalizePoint(1000, 1000, rect)).toEqual([1, 1]); // 초과 → 1
  });

  it("폭/높이 0이면 0", () => {
    expect(
      normalizePoint(5, 5, { left: 0, top: 0, width: 0, height: 0 }),
    ).toEqual([0, 0]);
  });
});

describe("AnnotationOverlay 툴바·그리기", () => {
  it("발표자에게만 도구 툴바를 보인다", () => {
    const { rerender } = render(
      <AnnotationOverlay isPresenter annotations={[]} onDraw={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "펜" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "레이저 포인터" }),
    ).toBeInTheDocument();

    rerender(
      <AnnotationOverlay
        isPresenter={false}
        annotations={[]}
        onDraw={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "펜" })).toBeNull();
  });

  it("펜 선택 후 그리면 onDraw(tool=pen)", () => {
    const onDraw = vi.fn();
    const { container } = render(
      <AnnotationOverlay isPresenter annotations={[]} onDraw={onDraw} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "펜" }));
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 20, clientY: 20, pointerId: 1 });
    expect(onDraw).toHaveBeenCalledTimes(1);
    expect(onDraw.mock.calls[0][0]).toMatchObject({ tool: "pen" });
  });

  it("레이저 선택 후 이동하면 onDraw(tool=laser)", () => {
    const onDraw = vi.fn();
    const { container } = render(
      <AnnotationOverlay isPresenter annotations={[]} onDraw={onDraw} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "레이저 포인터" }));
    const svg = container.querySelector("svg")!;
    fireEvent.pointerMove(svg, { clientX: 30, clientY: 30, pointerId: 1 });
    expect(onDraw).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "laser" }),
    );
  });

  it("onDraw가 없으면(시청자) 그려도 아무 일 없음", () => {
    const { container } = render(
      <AnnotationOverlay isPresenter={false} annotations={[]} />,
    );
    const svg = container.querySelector("svg")!;
    // 던지지 않는다(시청자는 그리기 비활성).
    expect(() =>
      fireEvent.pointerDown(svg, { clientX: 1, clientY: 1, pointerId: 1 }),
    ).not.toThrow();
  });
});

describe("AnnotationOverlay 렌더", () => {
  it("펜=polyline, 레이저=circle로 그린다", () => {
    const annotations: ActiveAnnotation[] = [
      {
        id: "p",
        tool: "pen",
        color: "var(--busy)",
        points: [
          [0.1, 0.1],
          [0.2, 0.2],
        ],
      },
      { id: "l", tool: "laser", color: "var(--online)", points: [[0.5, 0.5]] },
    ];
    const { container } = render(
      <AnnotationOverlay isPresenter={false} annotations={annotations} />,
    );
    expect(container.querySelector("polyline")).toBeTruthy();
    expect(container.querySelector("circle")).toBeTruthy();
  });
});
