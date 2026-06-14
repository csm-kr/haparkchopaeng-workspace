import { beforeEach, describe, expect, it, vi } from "vitest";

// figure 렌더 파이프라인 단위 테스트 — mupdf(wasm)·sharp·storage를 모킹한다(AC).
// 검증: box→픽셀 크롭 좌표·페이지 fallback·같은 페이지 1회 렌더·figure 단위 격리(R28).

// mupdf 상태(페이지 수·픽셀 크기·호출 추적)를 hoisted로 공유한다.
const { mupdfState } = vi.hoisted(() => ({
  mupdfState: {
    pageCount: 1,
    width: 1000,
    height: 1000,
    pageBytes: Uint8Array.from([1, 2, 3, 4]),
    loadPageCalls: [] as number[],
    toPixmapCalls: 0,
  },
}));

vi.mock("mupdf", () => {
  const pixmap = {
    getWidth: () => mupdfState.width,
    getHeight: () => mupdfState.height,
    asPNG: () => mupdfState.pageBytes,
  };
  const page = {
    toPixmap: () => {
      mupdfState.toPixmapCalls++;
      return pixmap;
    },
  };
  const doc = {
    countPages: () => mupdfState.pageCount,
    loadPage: (n: number) => {
      mupdfState.loadPageCalls.push(n);
      return page;
    },
  };
  return {
    Document: { openDocument: () => doc },
    Matrix: { scale: (sx: number, sy: number) => [sx, 0, 0, sy, 0, 0] },
    ColorSpace: { DeviceRGB: "DeviceRGB" },
  };
});

const { sharpState } = vi.hoisted(() => ({
  sharpState: { extractArgs: [] as unknown[] },
}));

vi.mock("sharp", () => {
  const make = () => {
    const inst = {
      extract: (region: unknown) => {
        sharpState.extractArgs.push(region);
        return inst;
      },
      png: () => inst,
      toBuffer: async () => Buffer.from("CROPPED"),
    };
    return inst;
  };
  return { default: () => make() };
});

const { uploadPngMock } = vi.hoisted(() => ({ uploadPngMock: vi.fn() }));
vi.mock("@/lib/storage", () => ({ uploadPng: uploadPngMock }));

const { renderFigures } = await import("@/lib/figure-render");

interface Fig {
  title: string;
  caption: string;
  interpretation: string;
  sourcePage: number;
  box: { ymin: number; xmin: number; ymax: number; xmax: number } | null;
  imageUrl: string | null;
}

function fig(partial: Partial<Fig>): Fig {
  return {
    title: "F",
    caption: "c",
    interpretation: "i",
    sourcePage: 1,
    box: null,
    imageUrl: null,
    ...partial,
  };
}

const PAGE_PNG = Buffer.from(Uint8Array.from([1, 2, 3, 4]));

beforeEach(() => {
  vi.clearAllMocks();
  mupdfState.pageCount = 3;
  mupdfState.width = 1000;
  mupdfState.height = 1000;
  mupdfState.loadPageCalls = [];
  mupdfState.toPixmapCalls = 0;
  sharpState.extractArgs = [];
  uploadPngMock.mockResolvedValue(undefined);
});

describe("renderFigures", () => {
  it("box가 유효하면 픽셀 좌표로 크롭해 figures/{paperId}/{i}.png로 올린다", async () => {
    const out = await renderFigures(Buffer.from("pdf"), "p1", [
      fig({ sourcePage: 1, box: { ymin: 100, xmin: 200, ymax: 600, xmax: 800 } }),
    ]);

    // W=H=1000 → left=200, top=100, width=600, height=500.
    expect(sharpState.extractArgs[0]).toEqual({
      left: 200,
      top: 100,
      width: 600,
      height: 500,
    });
    expect(uploadPngMock).toHaveBeenCalledWith("figures/p1/0.png", Buffer.from("CROPPED"));
    expect(out[0].imageUrl).toBe("figures/p1/0.png");
  });

  it("box가 없으면 페이지 전체 PNG로 fallback해 올린다(크롭 안 함)", async () => {
    const out = await renderFigures(Buffer.from("pdf"), "p1", [
      fig({ sourcePage: 1, box: null }),
    ]);

    expect(sharpState.extractArgs).toHaveLength(0);
    expect(uploadPngMock).toHaveBeenCalledWith("figures/p1/0.png", PAGE_PNG);
    expect(out[0].imageUrl).toBe("figures/p1/0.png");
  });

  it("box 폭/높이가 0 이하이면 무효 → 페이지 fallback", async () => {
    const out = await renderFigures(Buffer.from("pdf"), "p1", [
      // xmax<xmin → 폭 음수.
      fig({ sourcePage: 1, box: { ymin: 100, xmin: 800, ymax: 600, xmax: 200 } }),
    ]);
    expect(sharpState.extractArgs).toHaveLength(0);
    expect(out[0].imageUrl).toBe("figures/p1/0.png");
  });

  it("같은 페이지의 두 figure는 페이지를 한 번만 렌더한다", async () => {
    await renderFigures(Buffer.from("pdf"), "p1", [
      fig({ sourcePage: 2, box: null }),
      fig({ sourcePage: 2, box: null }),
    ]);
    // sourcePage 2 → 0-based index 1, 한 번만.
    expect(mupdfState.loadPageCalls).toEqual([1]);
    expect(mupdfState.toPixmapCalls).toBe(1);
  });

  it("sourcePage가 범위를 벗어나면 마지막 페이지로 클램프한다(off-by-one 방어)", async () => {
    mupdfState.pageCount = 2;
    await renderFigures(Buffer.from("pdf"), "p1", [fig({ sourcePage: 99, box: null })]);
    expect(mupdfState.loadPageCalls).toEqual([1]); // clamp → pageCount-1
  });

  it("한 figure의 업로드가 실패하면 그 figure만 imageUrl=null, 나머지는 채운다(R28)", async () => {
    uploadPngMock.mockRejectedValueOnce(new Error("업로드 실패")).mockResolvedValue(undefined);

    const out = await renderFigures(Buffer.from("pdf"), "p1", [
      fig({ sourcePage: 1, box: null }),
      fig({ sourcePage: 1, box: null }),
    ]);

    expect(out[0].imageUrl).toBeNull();
    expect(out[1].imageUrl).toBe("figures/p1/1.png");
  });
});
