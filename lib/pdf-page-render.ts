import * as mupdf from "mupdf";

// PDF 페이지 렌더 — 서버 전용(발표자료 라이브 공유 경로). PDF 한 페이지를 PNG로 래스터화한다.
// figure-render.ts와 같은 mupdf 파이프라인을 쓰되, 여기선 페이지 단위(크롭 없음)·요청 시 렌더다.
// CRITICAL: 환경/입력 오류로 라이브 전체가 막히지 않게 — countPdfPages는 못 열면 0(방어적).

const SCALE = 150 / 72; // PDF 포인트(72dpi) → 약 150dpi 픽셀(figure-render와 동일)

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/** PDF 페이지 수. 열지 못하면 0(호출부가 "PDF 없음/손상"으로 처리). */
export function countPdfPages(pdf: Buffer): number {
  try {
    const doc = mupdf.Document.openDocument(pdf, "application/pdf");
    return doc.countPages();
  } catch {
    return 0;
  }
}

/**
 * PDF의 한 페이지를 PNG로 렌더한다. pageIndex(0-based)는 [0, pageCount-1]로 클램프한다(off-by-one 방어).
 * PDF를 못 열면 throw — 호출(라우트)부가 5xx로 감싼다.
 */
export function renderPdfPageToPng(pdf: Buffer, pageIndex: number): Buffer {
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const count = doc.countPages();
  const idx = clamp(Math.floor(pageIndex), 0, Math.max(0, count - 1));
  const page = doc.loadPage(idx);
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(SCALE, SCALE),
    mupdf.ColorSpace.DeviceRGB,
    false,
  );
  return Buffer.from(pixmap.asPNG());
}
