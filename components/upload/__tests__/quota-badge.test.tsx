import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuotaBadge } from "../quota-badge";

// 상시 노출 쿼터 뱃지 — 라이브러리 상단바에 "이번 주 분석 X/20"을 항상 보여준다.
// 매주 월요일 0시(KST) 리셋 — lib/rate-limit.startOfWeekKST와 동일 의미.

describe("QuotaBadge", () => {
  it("한도가 있으면 이번 주 사용량을 상시 표시한다", () => {
    render(<QuotaBadge quota={{ limit: 20, used: 3, remaining: 17 }} />);
    expect(screen.getByText("3/20")).toBeInTheDocument();
    expect(screen.getByText(/이번 주/)).toBeInTheDocument();
  });

  it("한도를 다 쓰면 다음 주 리셋을 함께 안내한다", () => {
    render(<QuotaBadge quota={{ limit: 20, used: 20, remaining: 0 }} />);
    expect(screen.getByText("20/20")).toBeInTheDocument();
    expect(screen.getByText(/다음 주 리셋/)).toBeInTheDocument();
  });

  it("무제한(limit≤0)이면 아무것도 렌더하지 않는다", () => {
    const { container } = render(
      <QuotaBadge quota={{ limit: 0, used: 3, remaining: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("quota가 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<QuotaBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});
