import { createHash } from "node:crypto";
import { z } from "zod";

export const MAX_SOURCE_CHARACTERS = 120_000;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const SOURCE_FAILURES = {
  INVALID_PDF: "PDF 파일을 확인해주세요. 최대 20MB까지 읽을 수 있어요.",
  UNREADABLE_PDF: "PDF 본문을 읽지 못했어요. 텍스트를 선택할 수 있는 PDF로 다시 올려주세요.",
  PAGE_LIMIT: "PDF는 1~30쪽까지 분석할 수 있어요.",
  SEMINAR_PAGE_LIMIT: "세미나 PDF는 1~150쪽까지 읽을 수 있어요.",
  TEXT_LIMIT: "PDF 본문이 너무 길어요. 12만 자 이하의 논문을 사용해주세요.",
  NO_TEXT: "PDF에서 읽을 수 있는 본문을 찾지 못했어요. 비어 있거나 흐릿한 페이지인지 확인해주세요.",
  INVALID_CACHE: "논문 본문을 다시 준비해주세요.",
  SOURCE_CHANGED: "PDF 파일이 바뀌었어요. 자료를 확인하고 다시 시도해주세요.",
  RENDER_LIMIT: "PDF 페이지가 너무 커서 읽지 못했어요. 페이지 크기를 줄인 PDF로 다시 시도해주세요.",
  OCR_UNAVAILABLE: "이미지 본문 인식 기능을 준비하지 못했어요. 잠시 후 다시 시도해주세요.",
  OCR_FAILED: "이미지 본문을 읽지 못했어요. 더 선명한 PDF로 다시 시도해주세요.",
  OCR_TIMEOUT: "이미지 본문을 읽는 시간이 길어졌어요. 잠시 후 다시 시도해주세요.",
  OCR_CANCELLED: "PDF 본문 읽기를 중단했어요.",
} as const;
export class PaperSourceError extends Error {
  constructor(readonly code: keyof typeof SOURCE_FAILURES) {
    super(SOURCE_FAILURES[code]);
    this.name = "PaperSourceError";
  }
}
const GENERIC_SOURCE_FAILURE = "PDF 본문을 준비하지 못했어요. 텍스트를 포함한 PDF인지 확인하거나 AI 연결 후 다시 분석해주세요.";
export const SOURCE_FAILURE_MESSAGES: readonly string[] = Object.freeze([
  ...Object.values(SOURCE_FAILURES), GENERIC_SOURCE_FAILURE,
  // Existing stored failures must remain recognizable after OCR becomes available.
  "읽을 수 있는 본문 텍스트가 없어요. 스캔 PDF는 텍스트를 포함한 PDF로 바꿔주세요.",
]);

/** Persist only messages owned here; native/WASM exception text can contain private paths. */
export function sourceFailureMessage(error: unknown): string {
  return error instanceof PaperSourceError && Object.hasOwn(SOURCE_FAILURES, error.code)
    ? SOURCE_FAILURES[error.code]
    : GENERIC_SOURCE_FAILURE;
}

export function knownSourceFailureMessage(value: unknown): string | null {
  return typeof value === "string" && SOURCE_FAILURE_MESSAGES.includes(value) ? value : null;
}
const SourcePage = z.object({ page: z.number().int().min(1).max(150), text: z.string(), method: z.literal("ocr").optional() }).strict();
export type PaperSourcePage = z.infer<typeof SourcePage>;
export interface PaperSource { text: string; digest: string; pageCount: number }
export interface InspectedPaperSource extends PaperSource { ocrPages: number[] }
export interface OcrPageResult { page: number; text: string }

function parseSourcePages(text: string, maxPages: number): PaperSourcePage[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new PaperSourceError("INVALID_CACHE"); }
  const result = z.array(SourcePage).min(1).max(maxPages).safeParse(value);
  if (!result.success || result.data.some((page, i) => page.page !== i + 1 || page.page > maxPages) || result.data.reduce((n, p) => n + p.text.length, 0) > MAX_SOURCE_CHARACTERS) {
    throw new PaperSourceError("INVALID_CACHE");
  }
  return result.data;
}

export function parsePaperSource(text: string): PaperSourcePage[] { return parseSourcePages(text, 30); }

function cleanSourceText(text: string): string { return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim(); }

/** Inspection performs no OCR. Durable callers schedule each candidate page separately. */
export async function inspectPdfSource(pdf: Buffer, { maxPages = 30 }: { maxPages?: number } = {}): Promise<InspectedPaperSource> {
  if (!Buffer.isBuffer(pdf) || pdf.length > MAX_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-" || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 150) throw new PaperSourceError("INVALID_PDF");
  const mupdf = await import("mupdf");
  let document: InstanceType<typeof mupdf.Document>;
  try { document = mupdf.Document.openDocument(pdf, "application/pdf"); }
  catch { throw new PaperSourceError("UNREADABLE_PDF"); }
  try {
    const pageCount = document.countPages();
    if (pageCount < 1 || pageCount > maxPages) throw new PaperSourceError(maxPages === 30 ? "PAGE_LIMIT" : "SEMINAR_PAGE_LIMIT");
    const pages: PaperSourcePage[] = [], ocrPages: number[] = [];
    let size = 0;
    for (let index = 0; index < pageCount; index++) {
      const page = document.loadPage(index);
      try {
        const structured = page.toStructuredText("preserve-images");
        try {
          const text = cleanSourceText(structured.asText());
          let hasImage = false;
          structured.walk({ onImageBlock(_bounds, _transform, image) { hasImage = true; image.destroy(); } });
          // This threshold only schedules OCR; it never rejects short native text.
          if (!text || (hasImage && text.length < 80)) ocrPages.push(index + 1);
          size += text.length;
          if (size > MAX_SOURCE_CHARACTERS) throw new PaperSourceError("TEXT_LIMIT");
          pages.push({ page: index + 1, text });
        } finally { structured.destroy(); }
      } finally { page.destroy(); }
    }
    return { text: JSON.stringify(pages), digest: createHash("sha256").update(pdf).digest("hex"), pageCount, ocrPages };
  } finally { document.destroy(); }
}

/** All requested page results must be present before a complete source can enter the cache. */
export function mergePdfSource(inspected: InspectedPaperSource, ocrResults: readonly OcrPageResult[]): PaperSource {
  const pages = parseSourcePages(inspected.text, 150);
  if (!/^[a-f0-9]{64}$/.test(inspected.digest) || inspected.pageCount !== pages.length || !Array.isArray(inspected.ocrPages) ||
      new Set(inspected.ocrPages).size !== inspected.ocrPages.length || inspected.ocrPages.some(page => !Number.isInteger(page) || page < 1 || page > pages.length) ||
      !Array.isArray(ocrResults) || ocrResults.length !== inspected.ocrPages.length || new Set(ocrResults.map(result => result.page)).size !== ocrResults.length ||
      ocrResults.some(result => !inspected.ocrPages.includes(result.page) || typeof result.text !== "string")) throw new PaperSourceError("INVALID_CACHE");
  const recognized = new Map(ocrResults.map(result => [result.page, cleanSourceText(result.text)]));
  const merged = pages.map(page => {
    const ocr = recognized.get(page.page);
    if (!ocr) return page;
    const normalize = (text: string) => text.normalize("NFC").replace(/\s+/g, " ");
    const nativeText = normalize(page.text), ocrText = normalize(ocr);
    if (nativeText && nativeText.includes(ocrText)) return page;
    // OCR must not erase reliable selectable text; skip a fully repeated native passage.
    const text = nativeText && !ocrText.includes(nativeText) ? `${page.text}\n${ocr}` : ocr;
    return { page: page.page, text, method: "ocr" as const };
  });
  if (merged.reduce((size, page) => size + page.text.length, 0) > MAX_SOURCE_CHARACTERS) throw new PaperSourceError("TEXT_LIMIT");
  if (!merged.some(page => page.text.trim())) throw new PaperSourceError("NO_TEXT");
  return { text: JSON.stringify(merged), digest: inspected.digest, pageCount: inspected.pageCount };
}

/** Legacy text-only seam: callers that need OCR must use the durable inspection/page/merge flow. */
export async function extractPdfSource(pdf: Buffer, options: { maxPages?: number } = {}): Promise<PaperSource> {
  const inspected = await inspectPdfSource(pdf, options);
  return mergePdfSource({ ...inspected, ocrPages: [] }, []);
}
