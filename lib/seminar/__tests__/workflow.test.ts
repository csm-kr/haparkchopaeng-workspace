import { describe, expect, it } from "vitest";
import { SeminarActionSchema, SeminarDraftSchema } from "../contract";
import { acceptSeminarDecision, createSeminarWorkspace, queueSeminarAction, seminarContext, validateSeminarMedia } from "../workflow";

const pages = [{ page: 1, text: "Sparse routing reduces memory. Evaluation uses a fixed batch size." }];
const citation = { page: 1, quote: "Sparse routing reduces memory" };
const figures = [{ id: "fig-1", title: "Routing", caption: "Sparse routes", sourcePage: 1, available: true }];
const directions = [
  { id: "method", title: "작동 방식 이해", message: "라우팅으로 메모리를 줄인다", focus: "방법", tradeoff: "실험 비판은 짧게", citations: [citation] },
  { id: "critique", title: "실험 조건 검토", message: "배치 조건을 함께 검토해야 한다", focus: "비판", tradeoff: "구현 설명은 짧게", citations: [citation] },
];
const proposal = () => acceptSeminarDecision(createSeminarWorkspace("논문으로 세미나를 준비해줘"), { version: 1, action: "seminar_directions", message: "논문의 근거로 두 방향을 제안해요.", directions }, pages, figures);
const outline = ["문제", "방법", "토론"].map((title, i) => ({ id: `s${i+1}`, title, claim: "라우팅의 조건을 이해한다", visualPlan: "원문 그림 또는 흐름도", sourcePages: [1] }));
const deck = { title: "라우팅 세미나", durationMinutes: 30, summary: "방법과 한계를 토론한다", keypoints: ["희소 라우팅"], slides: outline.map(item => ({ title: item.title, body: "원문 p.1을 바탕으로 작동과 조건을 검토한다.", citations: [citation], visual: { kind: "diagram" as const, caption: "원문을 바탕으로 재구성한 설명 도식", nodes: [{ id: "input", label: "입력" }, { id: "route", label: "희소 라우팅" }], edges: [{ from: "input", to: "route", label: "선택" }] } })), citations: [citation] };

describe("논문 기반 PT 공동 제작 계약", () => {
  it("reads evidence before offering 2–3 distinct directions and does not start by asking a form", () => {
    const initial = createSeminarWorkspace("논문으로 세미나를 준비해줘");
    expect(initial.pending).toBe("directions"); expect(initial.question).toBeNull();
    const ready = proposal(); expect(ready.directions).toHaveLength(2); expect(ready.pending).toBeNull();
    expect(() => acceptSeminarDecision(initial, { version: 1, action: "seminar_directions", message: "제안", directions }, [], figures)).toThrow();
    expect(() => acceptSeminarDecision(initial, { version: 1, action: "seminar_directions", message: "제안", directions: [directions[0], directions[0]] }, pages, figures)).toThrow();
  });
  it("asks one recommended question and keeps the direction and answers in durable brief/context", () => {
    const chosen = queueSeminarAction(proposal(), { action: "choose", directionId: "method" });
    const state = acceptSeminarDecision(chosen, { version: 1, action: "seminar_question", message: "방법을 설명하는 방향으로 잡았어요.", brief: { message: "라우팅으로 메모리를 줄인다" }, question: { id: "depth", text: "방법을 어느 깊이까지 다룰까요?", options: [{ id: "overview", label: "핵심 흐름" }, { id: "repro", label: "재현 절차까지" }], recommendedId: "overview", reason: "첫 세미나는 핵심 흐름을 잡는 편이 좋아요." } }, pages, figures);
    expect(state.question?.recommendedId).toBe("overview"); expect(state.stage).toBe("interview");
    const answered = queueSeminarAction(state, { action: "answer", text: "재현 단계까지 설명하고 싶어" });
    expect(answered.messages.at(-1)?.text).toBe("재현 단계까지 설명하고 싶어");
    expect(seminarContext(answered)).toMatchObject({ selectedDirectionId: "method", pending: "interview" });
    expect(() => acceptSeminarDecision(chosen, { version: 1, action: "seminar_question", message: "질문? 또 질문?", brief: {}, question: { ...state.question } }, pages, figures)).toThrow();
  });
  it("requires an explicit outline/build action and preserves a revision request without registering", () => {
    const chosen = queueSeminarAction(proposal(), { action: "choose", directionId: "method" });
    expect(() => queueSeminarAction(chosen, { action: "build" })).toThrow();
    const interviewed = { ...chosen, pending: null };
    const planning = queueSeminarAction(interviewed, { action: "outline" });
    const planned = acceptSeminarDecision(planning, { version: 1, action: "seminar_outline", message: "세 장의 흐름으로 구성했어요.", brief: { durationMinutes: 20 }, outline }, pages, figures);
    expect(planned.outline).toHaveLength(3); expect(planned.deck).toBeNull();
    const building = queueSeminarAction(planned, { action: "build" });
    const built = acceptSeminarDecision(building, { version: 1, action: "seminar_draft", draft: deck }, pages, figures);
    expect(built.stage).toBe("deck"); expect(built.deck?.slides[0].visual?.kind).toBe("diagram");
    const revision = queueSeminarAction(built, { action: "revise", text: "방법 슬라이드에 원문 Figure 1을 넣어줘" });
    expect(revision.pending).toBe("deck"); expect(revision.deck).toEqual(deck);
    expect(() => queueSeminarAction({ ...planned, pending: "outline" }, { action: "build" })).toThrow();
  });
  it("rejects invented sources, foreign figures, invalid diagram edges and untrusted markup fields", () => {
    expect(SeminarDraftSchema.safeParse(deck).success).toBe(true);
    expect(() => validateSeminarMedia({ ...deck, slides: [{ ...deck.slides[0], visual: { kind: "figure", figureId: "foreign", caption: "그림" } }, ...deck.slides.slice(1)] }, pages, figures)).toThrow();
    expect(() => validateSeminarMedia({ ...deck, slides: [{ ...deck.slides[0], visual: { kind: "figure", figureId: "fig-1", caption: "그림" } }, ...deck.slides.slice(1)] }, pages, [{ ...figures[0], available: false }])).toThrow();
    expect(() => validateSeminarMedia({ ...deck, citations: [{ page: 2, quote: "invented quote" }] }, pages, figures)).toThrow();
    const invalidGraph = { ...deck, slides: [{ ...deck.slides[0], visual: { ...deck.slides[0].visual, edges: [{ from: "input", to: "missing" }] } }, ...deck.slides.slice(1)] };
    expect(() => validateSeminarMedia(invalidGraph, pages, figures)).toThrow();
    expect(SeminarActionSchema.safeParse({ expectedVersion: 1, requestId: crypto.randomUUID(), action: "answer", text: "답", approved: true }).success).toBe(false);
    expect(SeminarDraftSchema.safeParse({ ...deck, html: "<script>unsafe()</script>" }).success).toBe(false);
  });
  it("caps the dialogue and preserves compatibility with a text-only direct seminar", () => {
    const state = proposal();
    const full = { ...state, turnCount: 40 };
    expect(() => queueSeminarAction(full, { action: "revise", text: "추가 요청" })).toThrow();
    expect(SeminarDraftSchema.safeParse({ ...deck, slides: deck.slides.map(({ title, body }) => ({ title, body })) }).success).toBe(true);
  });
  it("keeps the agent's explanation with a deck revision so users can discuss the reasoning",() => {
    const workspace = { ...proposal(),stage: "deck" as const,deck,outline };
    const pending = queueSeminarAction(workspace,{ action: "revise",text: "이 도식을 선택한 이유를 설명해줘" });
    const result = acceptSeminarDecision(pending,{ version: 1,action: "seminar_draft",message: "입력과 라우팅의 관계를 보여주기 위해 원문 p.1을 바탕으로 도식을 구성했어요.",draft: deck },pages,figures);
    expect(result.messages.at(-1)?.text).toContain("관계를 보여주기 위해");
  });
});
