import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ReactionsLayer 단위 테스트 — 떠오르는 반응 이모지. 허용 keyframe(floatup)만 사용,
// reduced-motion은 CSS가 정적으로 대체(globals.css, R29).

const { ReactionsLayer } = await import("@/components/live/reactions-layer");

afterEach(() => cleanup());

describe("ReactionsLayer", () => {
  it("반응이 없으면 아무 이모지도 렌더하지 않는다", () => {
    const { container } = render(<ReactionsLayer reactions={[]} />);
    expect(container.querySelectorAll("[data-reaction]")).toHaveLength(0);
  });

  it("반응 이모지를 floatup 애니메이션으로 렌더한다", () => {
    render(
      <ReactionsLayer
        reactions={[
          { id: "a", emoji: "🔥", left: 30 },
          { id: "b", emoji: "👏", left: 60 },
        ]}
      />,
    );
    expect(screen.getByText("🔥")).toBeInTheDocument();
    const el = screen.getByText("👏");
    expect(el).toHaveClass("anim-floatup");
  });
});
