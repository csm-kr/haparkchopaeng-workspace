import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { countPdfPages } from "@/lib/pdf";

// PDF 페이지 수 카운트 — 실제 pdf-lib로 N쪽 PDF를 만들어 검증한다(모킹 없음).
// 업로드 시 "30쪽 초과" 제한 판정에 쓰인다(라우트에서 호출).

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

describe("countPdfPages", () => {
  it("1쪽 PDF는 1을 반환한다", async () => {
    const bytes = await makePdf(1);
    expect(await countPdfPages(bytes)).toBe(1);
  });

  it("여러 쪽 PDF의 페이지 수를 정확히 센다", async () => {
    const bytes = await makePdf(30);
    expect(await countPdfPages(bytes)).toBe(30);
  });

  it("Buffer 입력도 처리한다", async () => {
    const bytes = await makePdf(5);
    expect(await countPdfPages(Buffer.from(bytes))).toBe(5);
  });

  it("PDF가 아니면 던진다", async () => {
    await expect(countPdfPages(Buffer.from("not a pdf"))).rejects.toThrow();
  });
});
