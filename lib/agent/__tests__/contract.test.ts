// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseDecision, validateDraft, validateSeminarDraft, sourceRevision } from "../contract";

const pages = [{ page: 1, text: "The method reduces memory through sparse routing." }];
const draft = { title: "기여와 토론", body: "희소 라우팅의 메모리 절감 조건을 토론한다.", lens: "research", sectionId: "contributions", citations: [{ page: 1, quote: "reduces memory through sparse routing" }] };

describe("agent decision boundary", () => {
  it("accepts only the bounded domain tool language, never arbitrary authority or code", () => {
    expect(parseDecision(JSON.stringify({ version: 1, action: "read", tool: "paper.read", input: {} }))).toMatchObject({ action: "read", tool: "paper.read" });
    for (const value of [
      { version: 1, action: "read", tool: "shell", input: { command: "whoami" } },
      { version: 1, action: "read", tool: "paper.read", input: { teamId: "foreign" } },
      { version: 1, action: "draft", draft, approval: true },
      { version: 1, action: "save", draft },
    ]) expect(() => parseDecision(JSON.stringify(value))).toThrow();
    expect(() => parseDecision("```json\n{}\n```")).toThrow();
  });
  it("checks citations against pages actually read and enforces section/lens identity", () => {
    expect(validateDraft(draft, pages)).toMatchObject(draft);
    expect(() => validateDraft({ ...draft, citations: [{ page: 2, quote: "sparse routing" }] }, pages)).toThrow();
    expect(() => validateDraft({ ...draft, citations: [{ page: 1, quote: "invented result" }] }, pages)).toThrow();
    expect(() => validateDraft(draft, [])).toThrow();
    expect(() => validateDraft({ ...draft, lens: "repro", sectionId: "contributions" }, pages)).toThrow();
    expect(validateDraft({ ...draft, lens: "any", sectionId: "figures" }, pages).lens).toBe("any");
    expect(() => validateDraft({ ...draft, lens: "research", sectionId: "figures" }, pages)).toThrow();
  });
  it("binds source text, PDF digest and analysis request to the observed revision", () => {
    const paper = { sourceText: JSON.stringify(pages), sourceDigest: "pdf-a", analysisRequestId: "run-a" };
    const revision = sourceRevision(paper);
    expect(sourceRevision({ ...paper })).toBe(revision);
    expect(sourceRevision({ ...paper, sourceDigest: "pdf-b" })).not.toBe(revision);
    expect(sourceRevision({ ...paper, sourceText: "changed" })).not.toBe(revision);
    expect(sourceRevision({ ...paper, analysisRequestId: "run-b" })).not.toBe(revision);
  });
  it("validates a seminar outline and slide content against actual source pages", () => {
    const seminar = { title: "희소 라우팅 세미나", durationMinutes: 30, summary: "메모리 절감 방법과 조건을 토론한다.", keypoints: ["희소 라우팅", "실험 조건"], slides: [{ title: "문제", body: "메모리 사용" }, { title: "방법", body: "희소 라우팅" }, { title: "토론", body: "절감 조건은 무엇인가?" }], citations: draft.citations };
    expect(validateSeminarDraft(seminar, pages)).toMatchObject(seminar);
    expect(parseDecision(JSON.stringify({ version: 1, action: "seminar_draft", draft: seminar }))).toMatchObject({ action: "seminar_draft" });
    expect(() => validateSeminarDraft({ ...seminar, slides: [] }, pages)).toThrow();
    expect(() => validateSeminarDraft({ ...seminar, citations: [{ page: 1, quote: "unsupported claim" }] }, pages)).toThrow();
  });
});
