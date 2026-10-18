// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfSource } from "../source";

async function seminarPdf(pageCount: number) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index++) {
    document.addPage().drawText(`Seminar source page ${index + 1}: experimental evidence.`, { x: 30, y: 700, size: 10, font });
  }
  return Buffer.from(await document.save());
}

describe("seminar PDF preparation", () => {
  it("allows the explicit 150-page seminar limit while retaining original page numbers", async () => {
    const result = await extractPdfSource(await seminarPdf(150), { maxPages: 150 });
    const pages = JSON.parse(result.text);
    expect(result.pageCount).toBe(150);
    expect(pages[149]).toMatchObject({ page: 150 });
    expect(pages[149].text).toContain("Seminar source page 150");
  });

  it("keeps the 30-page paper default and rejects a seminar above 150 pages", async () => {
    await expect(extractPdfSource(await seminarPdf(31))).rejects.toMatchObject({ code: "PAGE_LIMIT" });
    await expect(extractPdfSource(await seminarPdf(151), { maxPages: 150 })).rejects.toMatchObject({ code: "SEMINAR_PAGE_LIMIT" });
  });
});
