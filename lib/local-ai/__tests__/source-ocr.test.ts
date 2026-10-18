// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { inspectPdfSource, mergePdfSource, parsePaperSource } from "../source";
import { fixturePdf } from "./pdf-fixtures";

describe("page-scoped PDF source preparation", () => {
  it("finds image and text-free pages without rejecting short selectable text", async () => {
    const inspected = await inspectPdfSource(await fixturePdf([
      { native: "Original selectable research evidence." },
      { image: "SCANNED RESEARCH EVIDENCE" },
      { native: "OK", image: "VISIBLE PAGE CONTENT" },
      {},
      { native: "Intro" },
    ]));
    expect(inspected.ocrPages).toEqual([2, 3, 4]);
    expect(inspected.pageCount).toBe(5);
    expect(JSON.parse(inspected.text)[4]).toEqual({ page: 5, text: "Intro" });
    expect(inspected.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("schedules a real vector-only page with no image blocks and keeps its recognized page number", async () => {
    const document = await PDFDocument.create();
    document.addPage([600, 300]).drawSvgPath("M 40 40 L 100 40 L 100 100 L 40 100 Z");
    const inspected = await inspectPdfSource(Buffer.from(await document.save()));
    expect(inspected.ocrPages).toEqual([1]);
    expect(JSON.parse(inspected.text)).toEqual([{ page: 1, text: "" }]);
    expect(parsePaperSource(mergePdfSource(inspected, [{ page: 1, text: "Recognized vector lettering" }]).text))
      .toEqual([{ page: 1, text: "Recognized vector lettering", method: "ocr" }]);
  });

  it("merges each requested page once, preserving page numbers and marking actual OCR text", async () => {
    const inspected = await inspectPdfSource(await fixturePdf([{ native: "Original native text" }, { image: "IMAGE TEXT" }, { native: "OK", blankImage: true }]));
    const merged = mergePdfSource(inspected, [{ page: 2, text: "Recognized image text" }, { page: 3, text: "" }]);
    expect(parsePaperSource(merged.text)).toEqual([
      { page: 1, text: "Original native text" },
      { page: 2, text: "Recognized image text", method: "ocr" },
      { page: 3, text: "OK" },
    ]);
    expect(merged.digest).toBe(inspected.digest);
    expect(merged.pageCount).toBe(3);
  });

  it("rejects incomplete, duplicate, unrelated and oversized OCR instead of caching a partial source", async () => {
    const inspected = await inspectPdfSource(await fixturePdf([{ image: "IMAGE TEXT" }]));
    for (const results of [[], [{ page: 1, text: "One" }, { page: 1, text: "Two" }], [{ page: 2, text: "Wrong" }]]) {
      expect(() => mergePdfSource(inspected, results)).toThrowError(expect.objectContaining({ code: "INVALID_CACHE" }));
    }
    expect(() => mergePdfSource(inspected, [{ page: 1, text: "x".repeat(120_001) }])).toThrowError(expect.objectContaining({ code: "TEXT_LIMIT" }));
    expect(() => mergePdfSource({ ...inspected, digest: "not-a-digest" }, [{ page: 1, text: "Valid text" }])).toThrowError(expect.objectContaining({ code: "INVALID_CACHE" }));
  });

  it("still rejects an empty PDF or a white scanned page after recognition", async () => {
    const blank = await inspectPdfSource(await fixturePdf([{}]));
    expect(blank.ocrPages).toEqual([1]);
    expect(() => mergePdfSource(blank, [{ page: 1, text: "" }])).toThrowError(expect.objectContaining({ code: "NO_TEXT" }));
    const scan = await inspectPdfSource(await fixturePdf([{ blankImage: true }]));
    expect(scan.ocrPages).toEqual([1]);
    expect(() => mergePdfSource(scan, [{ page: 1, text: " \n " }])).toThrowError(expect.objectContaining({ code: "NO_TEXT" }));
  });

  it("preserves selectable text when mixed-page OCR is empty or shorter and deduplicates contained text", async () => {
    const native = "Original native heading";
    const inspected = await inspectPdfSource(await fixturePdf([{ native, image: "SCANNED BODY" }]));
    for (const text of ["", "Original", "Original   native heading"]) {
      expect(parsePaperSource(mergePdfSource(inspected, [{ page: 1, text }]).text))
        .toEqual([{ page: 1, text: native }]);
    }
    expect(parsePaperSource(mergePdfSource(inspected, [{ page: 1, text: "New evidence" }]).text))
      .toEqual([{ page: 1, text: `${native}\nNew evidence`, method: "ocr" }]);
    const full = `${native}\nAdditional recognized evidence`;
    expect(parsePaperSource(mergePdfSource(inspected, [{ page: 1, text: full }]).text))
      .toEqual([{ page: 1, text: full, method: "ocr" }]);
  });

  it("retains strict legacy cache validation and accepts only the explicit OCR marker", () => {
    expect(parsePaperSource('[{"page":1,"text":"Legacy native text"}]')[0].text).toBe("Legacy native text");
    expect(parsePaperSource('[{"page":1,"text":"Recognized text","method":"ocr"}]')[0].method).toBe("ocr");
    expect(() => parsePaperSource('[{"page":1,"text":"Text","method":"external-api"}]')).toThrow();
    expect(() => parsePaperSource('[{"page":2,"text":"Text","method":"ocr"}]')).toThrow();
  });
});
