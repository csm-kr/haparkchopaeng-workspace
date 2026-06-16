import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LiveProvider } from "@/components/providers";
import { QuickCards } from "../quick-cards";
import { RecentActivity } from "../recent-activity";
import { LiveBanner } from "@/components/shell";

describe("QuickCards", () => {
  it("논문·발표 자료 개수를 카드로 렌더한다", () => {
    render(<QuickCards paperCount={5} presentationCount={3} />);

    const papers = screen.getByRole("link", { name: /논문/ });
    expect(papers).toHaveAttribute("href", "/library");
    expect(within(papers).getByText("5")).toBeInTheDocument();

    const pres = screen.getByRole("link", { name: /발표 자료/ });
    expect(pres).toHaveAttribute("href", "/presentations");
    expect(within(pres).getByText("3")).toBeInTheDocument();
  });
});

describe("RecentActivity", () => {
  const recentPapers = [
    { id: "p1", title: "Mixture of Depths", authors: "David Raposo 외", uploadedAt: "2026-06-10T09:00:00+09:00" },
  ];
  const recentPresentations = [
    { id: "pr1", title: "RAG 평가 회고", date: "2026-06-07T10:00:00+09:00" },
  ];

  it("최근 논문·발표 자료를 상세 링크로 렌더한다", () => {
    render(
      <RecentActivity
        recentPapers={recentPapers}
        recentPresentations={recentPresentations}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Mixture of Depths/ }),
    ).toHaveAttribute("href", "/papers/p1");
    expect(
      screen.getByRole("link", { name: /RAG 평가 회고/ }),
    ).toHaveAttribute("href", "/presentations/pr1");
  });

  it("아무 활동도 없으면 정직한 빈 상태를 보여준다", () => {
    render(<RecentActivity recentPapers={[]} recentPresentations={[]} />);
    expect(screen.getByText(/첫 논문을 올려볼까요/)).toBeInTheDocument();
  });
});

describe("LIVE 배너 (useLive 컨텍스트 의존)", () => {
  it("live=false면 배너가 보이지 않는다", () => {
    render(
      <LiveProvider initialLive={false}>
        <LiveBanner />
      </LiveProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("live=true면 라이브 안내 배너가 보인다", () => {
    render(
      <LiveProvider initialLive={true}>
        <LiveBanner />
      </LiveProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/모두의 세미나/);
  });
});
