// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildChatContext, contextWasTruncated } from "../context";

const paper = (id = "paper", text = "원문에서 직접 추출한 실험 증거") => ({ id, title: `논문 ${id}`, sourceText: JSON.stringify([{ page: 1, text }, { page: 2, text: "두 번째 원문 페이지" }]) });
const turn = (n: number, status = "completed") => ({ conversationTurn: n, prompt: `질문 ${n}`, response: `답변 ${n}`, status });

describe("private research context", () => {
  it("supports a free conversation without selected materials", () => {
    const { context, truncated } = buildChatContext([], [turn(1)]);
    const parsed = JSON.parse(context);
    expect(parsed.papers).toEqual([]);
    expect(parsed.history).toEqual([{ turn: 1, question: "질문 1", answer: "답변 1" }]);
    expect(truncated).toBe(false);
  });
  it("includes seminar text and original slide numbers alongside papers", () => {
    const result = buildChatContext([paper()], [], [{ id: "seminar", title: "토요일 세미나", pages: [{ page: 1, text: "표현 학습 발표 내용" }], summary: "발표 요약", keypoints: ["검토할 가정"], slides: [{ title: "실험", subtitle: "조건", body: "대조군의 차이" }] }]);
    const parsed = JSON.parse(result.context);
    expect(parsed.presentations[0]).toMatchObject({ id: "seminar", title: "토요일 세미나", pages: [{ page: 1, text: "표현 학습 발표 내용" }], summary: "발표 요약", keypoints: ["검토할 가정"], slides: [{ title: "실험", subtitle: "조건", body: "대조군의 차이" }] });
    expect(result.context.length).toBeLessThanOrEqual(200_000);
  });
  it("accounts for execution options inside the final model context budget", () => {
    const presentations = [{ id: "seminar", title: "큰 세미나", summary: "요약".repeat(80_000), keypoints: [], slides: [] }];
    const { context } = buildChatContext([paper("first", "문장".repeat(50_000))], [], presentations, { effort: "high" });
    expect(context.length).toBeLessThanOrEqual(200_000);
    expect(JSON.parse(context).execution).toEqual({ effort: "high" });
  });
  it("uses original numbered paper pages and completed recent turns only", () => {
    const { context, truncated } = buildChatContext([paper()], [turn(1), turn(2, "failed"), turn(3, "running"), turn(4)]);
    const parsed = JSON.parse(context);
    expect(parsed.papers[0].pages).toEqual([{ page: 1, text: "원문에서 직접 추출한 실험 증거" }, { page: 2, text: "두 번째 원문 페이지" }]);
    expect(parsed.history.map((item: { turn: number }) => item.turn)).toEqual([1, 4]);
    expect(truncated).toBe(false);
    expect(contextWasTruncated(context)).toBe(false);
  });
  it("keeps at most the last eight completed turns and reports omitted history", () => {
    const { context, truncated } = buildChatContext([paper()], Array.from({ length: 11 }, (_, i) => turn(i + 1)));
    expect(JSON.parse(context).history.map((item: { turn: number }) => item.turn)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(truncated).toBe(true);
    expect(contextWasTruncated(context)).toBe(true);
  });
  it("keeps valid JSON and every selected source/page under 200k even with escaped text and large history", () => {
    const papers = [paper("first", '"\\'.repeat(50_000)), paper("second", "연".repeat(110_000)), paper("third", "구".repeat(110_000))];
    const history = Array.from({ length: 8 }, (_, i) => ({ ...turn(i + 1), response: "지난 답변".repeat(12_000) }));
    const { context, truncated } = buildChatContext(papers, history);
    expect(context.length).toBeLessThanOrEqual(200_000);
    expect(truncated).toBe(true);
    const parsed = JSON.parse(context);
    expect(parsed.papers.map((item: { id: string }) => item.id)).toEqual(["first", "second", "third"]);
    expect(parsed.papers.every((item: { pages: { page: number; text: string }[] }) => item.pages.length === 2 && item.pages[0].page === 1 && item.pages[0].text.length > 0)).toBe(true);
    expect(parsed.history).toHaveLength(8);
  });
  it("fails honestly for unprepared, malformed, or empty original text", () => {
    for (const sourceText of [null, "", "private-but-invalid-source", "[]", '[{"page":1,"text":"   "}]']) {
      expect(() => buildChatContext([{ ...paper(), sourceText }], [])).toThrowError(expect.objectContaining({ code: "SOURCE_NOT_READY", status: 409 }));
    }
  });
});
