// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { TableBlock } from "@/types";
import { extractPdfSource, knownSourceFailureMessage, PaperSourceError, parsePaperSource, sourceFailureMessage } from "../source";
import { parseLocalAnalysis } from "../payload";

async function pdf(pages: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage();
    if (text) page.drawText(text, { x: 30, y: 700, size: 10, font });
  }
  return Buffer.from(await doc.save());
}

const pages = [
  { page: 1, text: "Our method reduces memory usage. Figure 1: Model architecture." },
  { page: 2, text: "We train the model for ten epochs using Adam." },
];
const table: TableBlock = { caption: "미기재", columns: [], rows: [] };
function bundle() {
  return {
    research: {
      problem: { oneLine: "메모리 사용 감소", setting: "원문 p.1", assumptions: [] },
      contributions: ["메모리 사용 감소"], io: { inputs: [], outputs: [] },
      comparison: table, ablation: table,
    },
    repro: {
      data: table, model: { params: "미기재", items: [] }, loss: [], metrics: [],
      training: { caption: "원문 p.2", rows: [["epochs", "10"]] },
      gpu: { hardware: "미기재", count: 0, vramGb: 0, vramUsedGb: 0, trainDays: 0, note: "수치 미기재" },
      repo: { found: false, url: null, summary: "외부 저장소 미확인", tree: [], source: "paper" },
      diagram: { nodes: [], edges: [] },
    },
    figures: [{ title: "Figure 1", caption: "Figure 1: Model architecture.", interpretation: "모델 구조 설명", sourcePage: 1 }],
    references: [
      { lens: "research", sourcePage: 1, quote: "Our method reduces memory usage." },
      { lens: "repro", sourcePage: 2, quote: "train the model for ten epochs" },
    ],
  };
}

describe("paper PDF source", () => {
  it("reads actual PDF pages in order with original text and a byte digest", async () => {
    const bytes = await pdf(pages.map((p) => p.text));
    const source = await extractPdfSource(bytes);
    const decoded = parsePaperSource(source.text);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({ page: 1 });
    expect(decoded[0].text).toContain("Our method reduces memory usage.");
    expect(decoded[1].text).toContain("ten epochs");
    expect(source.digest).toMatch(/^[a-f0-9]{64}$/);
    expect((await extractPdfSource(bytes)).digest).toBe(source.digest);
  });

  it("reports scan-only, unreadable, and over-30-page PDFs without pretending a summary exists", async () => {
    await expect(extractPdfSource(await pdf([""]))).rejects.toMatchObject({ name: "PaperSourceError", code: "NO_TEXT" });
    await expect(extractPdfSource(Buffer.from("not a pdf"))).rejects.toMatchObject({ name: "PaperSourceError", code: "INVALID_PDF" });
    await expect(extractPdfSource(await pdf(Array.from({ length: 31 }, () => "text")))).rejects.toMatchObject({ name: "PaperSourceError", code: "PAGE_LIMIT" });
  });

  it("uses an owned error code instead of private exception messages", () => {
    const failure = new PaperSourceError("TEXT_LIMIT");
    failure.message = "private filesystem path and native error";
    expect(sourceFailureMessage(failure)).toBe("PDF 본문이 너무 길어요. 12만 자 이하의 논문을 사용해주세요.");
    expect(sourceFailureMessage(new Error(failure.message))).not.toContain("private");
    expect(knownSourceFailureMessage(failure.message)).toBeNull();
    expect(knownSourceFailureMessage(sourceFailureMessage(failure))).toBe(sourceFailureMessage(failure));
    Object.defineProperty(failure, "code", { value: "constructor" });
    expect(sourceFailureMessage(failure)).toBe(sourceFailureMessage(null));
  });
});

describe("local structured analysis", () => {
  it("accepts a complete cited result and adds an honest text-only Figure interpretation", () => {
    const result = parseLocalAnalysis(JSON.stringify(bundle()), JSON.stringify(pages));
    expect(result.research.problem.oneLine).toBe("메모리 사용 감소");
    expect(result.repro.training.rows).toEqual([["epochs", "10"]]);
    expect(result.figures[0]).toMatchObject({ sourcePage: 1, imageUrl: null, box: null });
    expect(result.figures[0].interpretation).toMatch(/본문.*캡션/);
  });

  it("rejects missing structure, nonexistent pages, and a quote absent from the supplied page", () => {
    expect(() => parseLocalAnalysis('{"research":{}}', JSON.stringify(pages))).toThrow(/형식/);
    const wrongPage = bundle();
    wrongPage.references[1].sourcePage = 9;
    expect(() => parseLocalAnalysis(JSON.stringify(wrongPage), JSON.stringify(pages))).toThrow(/근거|페이지/);
    const fabricated = bundle();
    fabricated.references[0].quote = "The experiment achieved 100 percent accuracy.";
    expect(() => parseLocalAnalysis(JSON.stringify(fabricated), JSON.stringify(pages))).toThrow(/근거/);
  });

  it("rejects a fabricated Figure caption and an unvisited external repository claim", () => {
    const fabricated = bundle();
    fabricated.figures[0].caption = "Figure 9: Perfect accuracy.";
    expect(() => parseLocalAnalysis(JSON.stringify(fabricated), JSON.stringify(pages))).toThrow(/캡션|근거/);
    expect(() => parseLocalAnalysis(JSON.stringify({ ...bundle(), repro: { ...bundle().repro, repo: { found: true, url: "https://github.com/example/unknown", source: "repo", summary: "검증 완료", tree: [] } } }), JSON.stringify(pages))).toThrow(/형식/);
  });

  it("rejects quotes and captions that normalize to whitespace or invisible text", () => {
    for (const empty of ["        ", "\u00ad".repeat(8)]) {
      const value = bundle();
      value.references[0].quote = empty;
      expect(() => parseLocalAnalysis(JSON.stringify(value), JSON.stringify(pages))).toThrow(/근거/);
      const figure = bundle();
      figure.figures[0].caption = empty;
      expect(() => parseLocalAnalysis(JSON.stringify(figure), JSON.stringify(pages))).toThrow(/근거|캡션/);
    }
  });

  it("rejects mismatched table headers and cells", () => {
    const value = bundle();
    value.research.comparison = { caption: "비교", columns: ["Model", "Accuracy"], rows: [{ cells: ["Method A"], highlight: false }] };
    expect(() => parseLocalAnalysis(JSON.stringify(value), JSON.stringify(pages))).toThrow(/형식/);
  });
});
