import * as mupdf from "mupdf";
import sharp from "sharp";
import { uploadPng } from "@/lib/storage";
import type { FigureBox, FigureExtract } from "@/lib/analysis";

// figure 이미지 렌더 — 서버 전용(Inngest 잡 경로). PDF 페이지를 래스터화해 bbox 영역만 크롭하고,
// box가 없거나 무효면 그 페이지 전체를 fallback으로 쓴다. 업로드한 스토리지 경로를 imageUrl에 채워 돌려준다.
// CRITICAL: figure 단위 격리 — 한 figure의 렌더/크롭/업로드 실패가 나머지·분석 전체를 막지 않는다(R28).
// CRITICAL: imageUrl엔 스토리지 "경로"만 담는다(서명/공개 URL 금지, R36). 서빙 라우트가 단기 서명한다.

const SCALE = 150 / 72; // PDF 포인트(72dpi) → 약 150dpi 픽셀

interface RenderedPage {
  png: Buffer;
  width: number;
  height: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/** box(0–1000 정규화)를 페이지 픽셀 사각형으로 변환한다. 폭/높이가 0 이하이면 null(→ 페이지 fallback). */
function toPixelRect(
  box: FigureBox,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } | null {
  const left = clamp(Math.round((box.xmin / 1000) * width), 0, Math.max(0, width - 1));
  const top = clamp(Math.round((box.ymin / 1000) * height), 0, Math.max(0, height - 1));
  const w = clamp(Math.round(((box.xmax - box.xmin) / 1000) * width), 0, width - left);
  const h = clamp(Math.round(((box.ymax - box.ymin) / 1000) * height), 0, height - top);
  if (w <= 0 || h <= 0) return null;
  return { left, top, width: w, height: h };
}

/**
 * 각 figure 이미지를 PDF에서 추출해 스토리지에 올리고 imageUrl(경로)을 채운다.
 * 입력과 같은 길이·순서로 돌려준다. PDF를 못 열거나 한 figure가 실패하면 그 부분만 imageUrl=null로 둔다(R28).
 */
export async function renderFigures(
  pdf: Buffer,
  paperId: string,
  figures: FigureExtract[],
): Promise<FigureExtract[]> {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(pdf, "application/pdf");
  } catch {
    // PDF 자체를 못 열면 모든 figure는 imageUrl=null(메타 분석은 보존).
    return figures.map((f) => ({ ...f, imageUrl: null }));
  }

  const pageCount = doc.countPages();
  const pageCache = new Map<number, RenderedPage>();

  // 페이지는 인덱스별로 1회만 렌더한다(같은 페이지의 여러 figure가 공유).
  function renderPage(pageIndex: number): RenderedPage {
    const cached = pageCache.get(pageIndex);
    if (cached) return cached;
    const page = doc.loadPage(pageIndex);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(SCALE, SCALE),
      mupdf.ColorSpace.DeviceRGB,
      false,
    );
    const rendered: RenderedPage = {
      png: Buffer.from(pixmap.asPNG()),
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
    };
    pageCache.set(pageIndex, rendered);
    return rendered;
  }

  const out: FigureExtract[] = [];
  for (let i = 0; i < figures.length; i++) {
    const f = figures[i];
    try {
      const pageIndex = clamp((f.sourcePage || 1) - 1, 0, Math.max(0, pageCount - 1));
      const page = renderPage(pageIndex);

      let buf: Buffer = page.png; // fallback: 페이지 전체
      if (f.box) {
        const rect = toPixelRect(f.box, page.width, page.height);
        if (rect) {
          buf = await sharp(page.png).extract(rect).png().toBuffer();
        }
      }

      const path = `figures/${paperId}/${i}.png`;
      await uploadPng(path, buf);
      out.push({ ...f, imageUrl: path });
    } catch {
      // figure 단위 격리: 이 figure만 비우고 계속한다(R28).
      out.push({ ...f, imageUrl: null });
    }
  }
  return out;
}
