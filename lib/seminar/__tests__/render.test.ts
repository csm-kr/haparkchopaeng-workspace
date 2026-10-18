// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import sharp from "sharp";
import { renderSeminarDeck, type DeckAsset } from "../render";
import type { SeminarDraft } from "../contract";

const deck: SeminarDraft = { title: "희소 라우팅 연구 세미나", durationMinutes: 30, summary: "방법과 실험 조건을 함께 검토한다.", keypoints: ["원문 근거", "재현 조건"], citations: [{ page: 1, quote: "Sparse routing reduces memory" }], slides: ["연구 질문", "작동 방식", "한계와 토론"].map(title => ({ title, body: "입력별 경로 선택이 메모리 사용에 미치는 영향을 확인한다. 원문 p.1의 조건을 함께 검토한다.", speakerNotes: "선택과 계산 단계를 천천히 설명한다.", citations: [{ page: 1, quote: "Sparse routing reduces memory" }], visual: { kind: "diagram" as const, caption: "원문을 바탕으로 재구성한 설명 도식", nodes: [{ id: "input", label: "입력 데이터" }, { id: "route", label: "희소 라우팅" }, { id: "output", label: "선택한 결과" }], edges: [{ from: "input", to: "route", label: "선택" }, { from: "route", to: "output", label: "계산" }] } })) };

describe("발표 HTML/PDF와 렌더 검수", () => {
  it("creates matching 16:9 scenes and a real PDF with embedded readable Korean text", async () => {
    const result = await renderSeminarDeck(deck, new Map());
    expect(result.qa.slideCount).toBe(3); expect(result.qa.issues).toEqual([]);
    const pdf = mupdf.Document.openDocument(Buffer.from(result.pdf), "application/pdf");
    expect(pdf.countPages()).toBe(3);
    const page = pdf.loadPage(0), bounds = page.getBounds();
    expect((bounds[2]-bounds[0])/(bounds[3]-bounds[1])).toBeCloseTo(16/9, 5);
    expect(page.toStructuredText().asText()).toContain("연구 질문");
    expect(result.html).toContain('data-slide="0"'); expect(result.html).toContain("ArrowRight");
    expect(result.html).toContain("data:font/ttf;base64,");
    for (const scene of result.scenes) for (const item of scene.items) {
      expect(item.x).toBeGreaterThanOrEqual(0); expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.x+item.width).toBeLessThanOrEqual(1280); expect(item.y+item.height).toBeLessThanOrEqual(720);
    }
  });
  it("escapes source/user text and embeds only supplied real image bytes", async () => {
    const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: "white" } }).png().toBuffer();
    const asset: DeckAsset = { bytes: png, mime: "image/png", width: 640, height: 360 };
    const imageDeck = { ...deck, title: '<script>alert("x")</script>', slides: [{ ...deck.slides[0], title: "원문 Figure", visual: { kind: "figure" as const, figureId: "fig-1", caption: "실제 원문 그림" } }, ...deck.slides.slice(1)] };
    const result = await renderSeminarDeck(imageDeck, new Map([["figure:fig-1", asset]]));
    expect(result.html).not.toContain('<script>alert("x")</script>');
    expect(result.html).toContain("&lt;script&gt;"); expect(result.html).toContain("data:image/png;base64,");
    await expect(renderSeminarDeck(imageDeck, new Map())).rejects.toThrow(/그림|자산/);
  });
  it("refuses overflow and impossible table layouts rather than exporting clipped content", async () => {
    await expect(renderSeminarDeck({ ...deck, slides: [{ ...deck.slides[0], body: "긴 설명을 줄이지 않고 계속 적으면 글자가 프레임을 벗어나요. ".repeat(70) }, ...deck.slides.slice(1)] }, new Map())).rejects.toThrow(/슬라이드|넘|줄/);
    await expect(renderSeminarDeck({ ...deck, slides: [{ ...deck.slides[0], visual: { kind: "table", caption: "실험 조건", columns: ["조건", "결과"], rows: [["원문", "1", "잘못된 추가 열"]] } }, ...deck.slides.slice(1)] }, new Map())).rejects.toThrow();
  });
  it("keeps labels readable when multiple cross-row diagram edges share a midpoint",async () => {
    const labels = ["실행 조건","재현 지침","측정 지침","연구 한계","추가 한계"];
    const visual = { kind: "diagram" as const,caption: "설명용 재구성",nodes: ["조건부 근거","구현 환경","구현 일치","분리 측정","실험 제약","추가 검증"].map((label,n) => ({ id: `n${n}`,label })),edges: [[0,1],[1,2],[1,3],[0,4],[4,5]].map(([from,to],n) => ({ from: `n${from}`,to: `n${to}`,label: labels[n] })) };
    const output = await renderSeminarDeck({ ...deck,slides: [{ ...deck.slides[0],visual },...deck.slides.slice(1)] },new Map());
    const boxes = output.scenes[0].items.filter(item => item.kind === "text" && labels.includes(item.lines.join("")));
    expect(boxes).toHaveLength(5);
    for (let a=0;a<boxes.length;a++) for (let b=a+1;b<boxes.length;b++) {
      const left=boxes[a],right=boxes[b]; expect(left.x >= right.x+right.width || right.x >= left.x+left.width || left.y >= right.y+right.height || right.y >= left.y+left.height).toBe(true);
    }
  });
  it("rejects unsupported glyphs before silently emitting missing-character boxes",async () => {
    await expect(renderSeminarDeck({ ...deck,slides: [{ ...deck.slides[0],body: "결과 🪿" },...deck.slides.slice(1)] },new Map()).then(() => "exported")).rejects.toThrow(/문자|기호/);
  });
});
