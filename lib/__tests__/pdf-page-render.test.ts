import { beforeEach, describe, expect, it, vi } from "vitest";

// PDF 페이지 렌더 단위 테스트 — mupdf(wasm)를 모킹한다(figure-render 테스트와 동일 패턴).
// 검증: 페이지 수 반환·못 열면 0·페이지 PNG 반환·인덱스 범위 클램프(off-by-one 방어).

const { mupdfState } = vi.hoisted(() => ({
  mupdfState: {
    pageCount: 3,
    pageBytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), // PNG 매직
    loadPageCalls: [] as number[],
    throwOnOpen: false,
  },
}));

vi.mock("mupdf", () => {
  const pixmap = { asPNG: () => mupdfState.pageBytes };
  const page = { toPixmap: () => pixmap };
  const doc = {
    countPages: () => mupdfState.pageCount,
    loadPage: (n: number) => {
      mupdfState.loadPageCalls.push(n);
      return page;
    },
  };
  return {
    Document: {
      openDocument: () => {
        if (mupdfState.throwOnOpen) throw new Error("못 여는 PDF");
        return doc;
      },
    },
    Matrix: { scale: (sx: number, sy: number) => [sx, 0, 0, sy, 0, 0] },
    ColorSpace: { DeviceRGB: "DeviceRGB" },
  };
});

const { countPdfPages, renderPdfPageToPng } = await import("@/lib/pdf-page-render");

beforeEach(() => {
  vi.clearAllMocks();
  mupdfState.pageCount = 3;
  mupdfState.loadPageCalls = [];
  mupdfState.throwOnOpen = false;
});

describe("countPdfPages", () => {
  it("페이지 수를 반환한다", () => {
    expect(countPdfPages(Buffer.from("pdf"))).toBe(3);
  });

  it("PDF를 못 열면 0을 반환한다(방어적)", () => {
    mupdfState.throwOnOpen = true;
    expect(countPdfPages(Buffer.from("bad"))).toBe(0);
  });
});

describe("renderPdfPageToPng", () => {
  it("페이지 PNG 바이트를 Buffer로 반환한다", () => {
    const out = renderPdfPageToPng(Buffer.from("pdf"), 1);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out).toEqual(Buffer.from(mupdfState.pageBytes));
    expect(mupdfState.loadPageCalls).toEqual([1]);
  });

  it("범위를 넘는 인덱스는 마지막 페이지로 클램프한다", () => {
    renderPdfPageToPng(Buffer.from("pdf"), 99);
    expect(mupdfState.loadPageCalls).toEqual([2]); // pageCount(3) - 1
  });

  it("음수 인덱스는 0으로 클램프한다", () => {
    renderPdfPageToPng(Buffer.from("pdf"), -5);
    expect(mupdfState.loadPageCalls).toEqual([0]);
  });
});
