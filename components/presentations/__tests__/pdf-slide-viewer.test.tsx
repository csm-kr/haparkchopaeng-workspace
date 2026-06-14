import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PdfSlideViewer } from "../pdf-slide-viewer";
import { PresentationViewer } from "../presentation-viewer";
import type { AssetView, PresentationMeta } from "../types";

// PDF 슬라이드 뷰어 — 첨부 PDF를 자산 라우트로 인라인 임베드하고, 새 탭 열기 fallback을 제공한다.
// PresentationViewer는 PDF asset이 있을 때만 뷰어를 렌더한다(PPTX/note는 다운로드 유지).

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
  it("PDF를 자산 라우트로 임베드한다", () => {
    render(<PdfSlideViewer presentationId="pres1" assetId="a1" name="MoD 리뷰" />);
    const frame = screen.getByTitle(/MoD 리뷰/);
    expect(frame).toHaveAttribute("src", "/api/presentations/pres1/assets/a1");
  });

  it("인라인 렌더가 막힐 때 대비 새 탭 열기 링크를 제공한다", () => {
    render(<PdfSlideViewer presentationId="pres1" assetId="a1" name="MoD 리뷰" />);
    const open = screen.getByRole("link", { name: "새 탭에서 열기" });
    expect(open).toHaveAttribute("href", "/api/presentations/pres1/assets/a1");
    expect(open).toHaveAttribute("target", "_blank");
  });
});

describe("PresentationViewer 슬라이드 임베드", () => {
  it("PDF asset이 있으면 슬라이드 뷰어를 임베드한다", () => {
    render(
      <PresentationViewer
        presentation={baseMeta}
        assets={[pdfAsset]}
        versions={[]}
      />,
    );
    expect(screen.getByTitle(/MoD 리뷰/)).toHaveAttribute(
      "src",
      "/api/presentations/pres1/assets/a1",
    );
  });

  it("PDF 없이 PPTX만 있으면 슬라이드 뷰어를 임베드하지 않는다", () => {
    render(
      <PresentationViewer
        presentation={baseMeta}
        assets={[pptAsset]}
        versions={[]}
      />,
    );
    expect(screen.queryByTitle(/MoD 리뷰/)).not.toBeInTheDocument();
  });
});
