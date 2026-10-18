import { createHash } from "node:crypto";
import { z } from "zod";

export const MAX_SOURCE_CHARACTERS = 120_000;
const SOURCE_FAILURES = {
  INVALID_PDF: "PDF 파일을 확인해주세요. 최대 20MB까지 읽을 수 있어요.",
  UNREADABLE_PDF: "PDF 본문을 읽지 못했어요. 텍스트를 선택할 수 있는 PDF로 다시 올려주세요.",
  PAGE_LIMIT: "PDF는 1~30쪽까지 분석할 수 있어요.",
  TEXT_LIMIT: "PDF 본문이 너무 길어요. 12만 자 이하의 논문을 사용해주세요.",
  NO_TEXT: "읽을 수 있는 본문 텍스트가 없어요. 스캔 PDF는 텍스트를 포함한 PDF로 바꿔주세요.",
  INVALID_CACHE: "논문 본문을 다시 준비해주세요.",
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
const SourcePages = z.array(z.object({ page: z.number().int().min(1).max(30), text: z.string() }).strict()).min(1).max(30);
export interface PaperSource { text: string; digest: string; pageCount: number }

export function parsePaperSource(text: string): { page: number; text: string }[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new PaperSourceError("INVALID_CACHE"); }
  const result = SourcePages.safeParse(value);
  if (!result.success || result.data.some((page, i) => page.page !== i + 1) || result.data.reduce((n, p) => n + p.text.length, 0) > MAX_SOURCE_CHARACTERS) {
    throw new PaperSourceError("INVALID_CACHE");
  }
  return result.data;
}

/** External durable job only. Original page numbers survive extraction; no silent truncation. */
export async function extractPdfSource(pdf: Buffer): Promise<PaperSource> {
  if (pdf.length > 20 * 1024 * 1024 || pdf.subarray(0, 5).toString() !== "%PDF-") throw new PaperSourceError("INVALID_PDF");
  const mupdf = await import("mupdf");
  let document: InstanceType<typeof mupdf.Document>;
  try { document = mupdf.Document.openDocument(pdf, "application/pdf"); }
  catch { throw new PaperSourceError("UNREADABLE_PDF"); }
  try {
    const pageCount = document.countPages();
    if (pageCount < 1 || pageCount > 30) throw new PaperSourceError("PAGE_LIMIT");
    const pages: { page: number; text: string }[] = [];
    let size = 0;
    for (let index = 0; index < pageCount; index++) {
      const page = document.loadPage(index);
      try {
        const structured = page.toStructuredText();
        try {
          const text = structured.asText().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
          size += text.length;
          if (size > MAX_SOURCE_CHARACTERS) throw new PaperSourceError("TEXT_LIMIT");
          pages.push({ page: index + 1, text });
        } finally { structured.destroy(); }
      } finally { page.destroy(); }
    }
    if (!pages.some((page) => page.text.trim().length >= 20)) throw new PaperSourceError("NO_TEXT");
    return { text: JSON.stringify(pages), digest: createHash("sha256").update(pdf).digest("hex"), pageCount };
  } finally { document.destroy(); }
}
