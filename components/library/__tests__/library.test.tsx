import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PaperList } from "../paper-list";
import type { PaperListItem } from "../paper-list";

const papers: PaperListItem[] = [
  {
    id: "p1",
    title: "Mixture-of-Depths",
    authors: "Raposo et al., DeepMind",
    tag: "LLM",
    analysisStatus: "ready",
    uploadedAt: "2026-06-13T14:22:00+09:00",
    uploader: { name: "조성민", initial: "조", color: "var(--m-jo)" },
  },
  {
    id: "p2",
    title: "ReALM",
    authors: "Moniz et al., Apple",
    tag: "NLP",
    analysisStatus: "pending",
    uploadedAt: "2026-06-12T18:40:00+09:00",
    uploader: { name: "하수현", initial: "하", color: "var(--m-ha)" },
  },
];

describe("PaperList", () => {
  it("논문 행을 제목·저자·업로더와 함께 렌더하고 상세로 링크한다", () => {
    render(<PaperList papers={papers} />);

    const row = screen.getByRole("link", { name: /Mixture-of-Depths/ });
    expect(row).toHaveAttribute("href", "/papers/p1");
    expect(within(row).getByText("Raposo et al., DeepMind")).toBeInTheDocument();
    expect(within(row).getByText("LLM")).toBeInTheDocument();
    // 업로더 아바타(작성자 표기)
    expect(screen.getByRole("img", { name: "조성민 아바타" })).toBeInTheDocument();
  });

  it("필터 칩은 '전체' 하나뿐이다(타입 필터 없음, R17)", () => {
    render(<PaperList papers={papers} />);
    const chips = screen.getAllByText(/^전체$/);
    expect(chips).toHaveLength(1);
  });

  it("논문이 없으면 정직한 빈 상태를 보여준다", () => {
    render(<PaperList papers={[]} />);
    expect(screen.getByText(/아직 올라온 논문이 없어요/)).toBeInTheDocument();
    // 빈 상태에선 필터 칩/행이 없다.
    expect(screen.queryByText(/^전체$/)).toBeNull();
  });

  it("분석이 ready가 아니면 가벼운 상태 표시를 보여준다", () => {
    render(<PaperList papers={papers} />);
    // pending 논문(p2)에 "분석 중" 표시
    const pending = screen.getByRole("link", { name: /ReALM/ });
    expect(within(pending).getByText("분석 중")).toBeInTheDocument();
    // ready 논문(p1)에는 상태 표시 없음
    const ready = screen.getByRole("link", { name: /Mixture-of-Depths/ });
    expect(within(ready).queryByText(/분석/)).toBeNull();
  });
});
