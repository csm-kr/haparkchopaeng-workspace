import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PdfSlideViewer } from "../pdf-slide-viewer";
import { PresentationViewer } from "../presentation-viewer";
import type { AssetView, PresentationMeta } from "../types";

// PDF 슬라이드 뷰어 — 서버가 페이지 PNG로 렌더한 것(/pages/:n)을 <img>로 한 장씩 넘긴다.
// 페이지 수는 /pages 카운트 라우트에서 받고, 전환은 이미지 스왑이라 즉각적이다.
// 전체화면 토글과 "PDF 받기"(새 창) 링크를 제공한다.
// fetch는 jsdom에 없으므로 카운트 라우트만 모킹한다(이미지 렌더 자체는 검증 대상 아님).

beforeEach(() => {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/pages")) {
      return {
        ok: true,
        json: async () => ({ data: { count: 3 } }),
      } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const jo = {
  id: "jo",
  name: "조성민",
  handle: "@chominho",
  initial: "조",
  color: "var(--m-jo)",
};

const baseMeta: PresentationMeta = {
  id: "pres1",
  title: "MoD 리뷰",
  presenterId: "jo",
  presenter: jo,
  date: "2026-06-13T07:00:00.000Z",
  duration: "30분",
  slideCount: 0,
  tags: [],
  summary: null,
  keypoints: [],
  slides: [],
};

const pdfAsset: AssetView = {
  id: "a1",
  name: "slides.pdf",
  type: "pdf",
  size: "2.1MB",
  url: "presentations/pres1/slides.pdf",
};

const pptAsset: AssetView = {
  id: "a2",
  name: "deck.pptx",
  type: "ppt",
  size: "5.0MB",
  url: "presentations/pres1/deck.pptx",
};

describe("PdfSlideViewer", () => {
  it("페이지 수를 받아 첫 페이지 인디케이터(1 / 총장)를 보여준다", async () => {
    render(<PdfSlideViewer presentationId="pres1" assetId="a1" name="MoD 리뷰" />);
    expect(await screen.findByText("1 / 3")).toBeInTheDocument();
  });

  it("첫 페이지에선 '이전'이 비활성이고, '다음'으로 한 장 넘긴다", async () => {
    render(<PdfSlideViewer presentationId="pres1" assetId="a1" name="MoD 리뷰" />);
    await screen.findByText("1 / 3");

    expect(screen.getByRole("button", { name: "이전 페이지" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));

    expect(await screen.findByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이전 페이지" })).toBeEnabled();
  });

  it("현재 페이지를 서버 페이지 이미지로 렌더한다", async () => {
    render(<PdfSlideViewer presentationId="pres1" assetId="a1" name="MoD 리뷰" />);
    await screen.findByText("1 / 3");

    const img = screen.getByAltText("MoD 리뷰 슬라이드 1페이지");
    expect(img).toHaveAttribute("src", "/api/presentations/pres1/pages/1");

    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
    await screen.findByText("2 / 3");
    expect(
      screen.getByAltText("MoD 리뷰 슬라이드 2페이지"),
    ).toHaveAttribute("src", "/api/presentations/pres1/pages/2");
  });

  it("전체화면 토글과 'PDF 받기'(새 창) 링크를 제공한다", async () => {
    render(<PdfSlideViewer presentationId="pres1" assetId="a1" name="MoD 리뷰" />);
    await screen.findByText("1 / 3");

    expect(
      screen.getByRole("button", { name: "전체화면" }),
    ).toBeInTheDocument();

    const open = screen.getByRole("link", { name: "PDF 받기" });
    expect(open).toHaveAttribute("href", "/api/presentations/pres1/assets/a1");
    expect(open).toHaveAttribute("target", "_blank");
  });
});

describe("PresentationViewer 슬라이드 임베드", () => {
  it("PDF asset이 있으면 슬라이드 뷰어를 렌더한다", async () => {
    render(
      <PresentationViewer
        presentation={baseMeta}
        assets={[pdfAsset]}
        versions={[]}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "슬라이드" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("1 / 3")).toBeInTheDocument();
  });

  it("PDF 없이 PPTX만 있으면 슬라이드 뷰어를 렌더하지 않는다", () => {
    render(
      <PresentationViewer
        presentation={baseMeta}
        assets={[pptAsset]}
        versions={[]}
      />,
    );
    expect(
      screen.queryByRole("heading", { name: "슬라이드" }),
    ).not.toBeInTheDocument();
  });
});
