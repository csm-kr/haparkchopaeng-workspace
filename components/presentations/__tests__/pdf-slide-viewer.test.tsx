import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PdfSlideViewer } from "../pdf-slide-viewer";
import { PresentationViewer } from "../presentation-viewer";
import type { AssetView, PresentationMeta } from "../types";

// PDF 슬라이드 뷰어 — pdf.js로 PDF를 페이지 단위로 렌더하고, 이전/다음으로 한 장씩 넘긴다.
// 전체화면 토글과 새 탭 열기 fallback을 제공한다.
// pdf.js는 브라우저 전용(canvas/worker)이라 단위 테스트에선 모킹한다.

// pdf.js 모킹 — 3페이지 문서. 실제 렌더(canvas)는 검증 대상이 아니라 페이지 내비게이션 로직만 본다.
vi.mock("pdfjs-dist", () => {
  const page = {
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: 800 * scale,
      height: 600 * scale,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  };
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    version: "6.0.227",
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: () => Promise.resolve(page),
        destroy: () => {},
      }),
    }),
  };
});

beforeAll(() => {
  // jsdom은 canvas 2D 컨텍스트를 구현하지 않는다 → 렌더 경로가 죽지 않도록 stub.
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({}),
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
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
  it("PDF를 로드해 첫 페이지 인디케이터(1 / 총장)를 보여준다", async () => {
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

  it("전체화면 토글과 새 탭 열기 fallback을 제공한다", async () => {
    render(<PdfSlideViewer presentationId="pres1" assetId="a1" name="MoD 리뷰" />);
    await screen.findByText("1 / 3");

    expect(
      screen.getByRole("button", { name: "전체화면" }),
    ).toBeInTheDocument();

    const open = screen.getByRole("link", { name: "새 탭에서 열기" });
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
