import { expect, test, type Page } from "@playwright/test";
import type { AgentTaskView } from "../../types/agent-task";
import { acceptSeminarDecision, createSeminarWorkspace, queueSeminarAction } from "../../lib/seminar/workflow";

// Browser contract fixture; actual persistence/authority/model transitions are tested on the disposable DB.
async function setup(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: { email: "de8167@gmail.com" } })).ok()).toBeTruthy();
  const now = new Date().toISOString();
  await page.addInitScript(() => Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false } }));
  const device = { id: "pt-ui-pc", name: "PT 검증 PC", platform: "windows", online: true, lastSeenAt: now, leaseExpiresAt: new Date(Date.now()+45_000).toISOString(), providers: [{ provider: "codex", status: "ready", models: [{ id: "fixture-model", name: "Fixture model" }], quota: null, observedAt: now, capabilities: ["agent_step_v1"] }] };
  await page.route("**/api/local-agent/**", route => { const path = new URL(route.request().url()).pathname; return route.fulfill({ json: { data: path.endsWith("/status") ? { device, devices: [device], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 } : path.endsWith("/web-heartbeat") ? { leaseExpiresAt: device.leaseExpiresAt } : { releases: [] } } }); });
  const citation = { page: 1, quote: "Sparse routing reduces memory" }, pages = [{ page: 1, text: "Sparse routing reduces memory under a fixed batch size." }];
  const initial = createSeminarWorkspace("논문을 먼저 읽고 발표 방향을 제안해줘");
  const directions = [
    { id: "method", title: "라우팅 원리 이해", message: "희소 라우팅이 메모리 절감을 만든다", focus: "방법과 흐름을 도식으로 설명", tradeoff: "벤치마크 비교는 짧게", citations: [citation] },
    { id: "critique", title: "실험 조건 비판", message: "배치 조건을 함께 검토해야 한다", focus: "비교 조건과 한계", tradeoff: "구현 설명은 짧게", citations: [citation] },
  ];
  const outline = ["연구 문제", "라우팅 방법", "재현과 토론"].map((title, i) => ({ id: `s${i+1}`, title, claim: "메모리 절감의 조건을 검토한다", visualPlan: "원문에 근거한 설명 도식", sourcePages: [1] }));
  const deck = { title: "희소 라우팅 연구 세미나", durationMinutes: 30, summary: "기여와 실험 조건을 함께 토론한다", keypoints: ["희소 라우팅", "배치 조건"], citations: [citation], slides: outline.map(slide => ({ title: slide.title, body: "원문 p.1에서 희소 라우팅과 메모리 사용의 관계를 확인한다.", speakerNotes: "입력과 라우팅 단계를 차례로 설명한다.", citations: [citation], visual: { kind: "diagram" as const, caption: "원문을 바탕으로 재구성한 설명 도식", nodes: [{ id: "a", label: "입력" }, { id: "b", label: "희소 라우팅" }], edges: [{ from: "a", to: "b", label: "선택" }] } })) };
  let task: AgentTaskView = { id: "seminar-ui-task", kind: "seminar", conversationId: null, version: 100, revision: 0, goal: initial.messages[0].text, status: "waiting_input", phase: "seminar_directions", paper: { id: "local-agent-paper", title: "격리 검증용 논문" }, draft: null, seminarDraft: null, savedNote: null, savedPresentation: null, error: null, goalVerified: false, canCancel: true, canSave: false, canResume: true, decisionCount: 1, toolCount: 2, createdAt: now, updatedAt: now, activity: [], workspace: acceptSeminarDecision(initial, { version: 1, action: "seminar_directions", message: "원문을 읽고 두 방향을 찾았어요. 방법 이해를 추천해요.", directions }, pages, []) };
  let saved = 0; const turns: Record<string, unknown>[] = [];
  await page.route("**/api/agent/tasks**", async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (method === "POST" && path.endsWith("/exports")) {
      const input = route.request().postDataJSON();
      task = { ...task, version: task.version+1, seminarDraft: input.seminar, workspace: { ...task.workspace!, deck: input.seminar }, export: { id: input.requestId, status: "done", current: true, error: null, files: ["html", "pdf"].map(format => ({ format: format as "html"|"pdf", href: `/api/agent/tasks/${task.id}/exports/${input.requestId}/file?format=${format}` })), qa: { slideCount: 3, aspectRatio: "16:9", embeddedFonts: ["Pretendard"], issues: [] } } };
      await route.fulfill({ status: 202, json: { data: { task, export: task.export } } }); return;
    }
    if (method === "POST" && path.endsWith("/seminar")) {
      const input = route.request().postDataJSON(); turns.push(input);
      const queued = queueSeminarAction(task.workspace!, { action: input.action, ...(input.text ? { text: input.text } : {}), ...(input.directionId ? { directionId: input.directionId } : {}) });
      const decision = input.action === "choose" || input.action === "answer" ? { version: 1, action: "seminar_question", message: input.action === "answer" ? "재현을 강조하는 요청을 기획에 반영했어요." : "방법 이해를 중심에 놓고 함께 준비해요.", brief: { audience: "재현에 관심이 있는 팀원", depth: "구현과 실험 재현" }, question: { id: "depth", text: "재현 설명은 어디까지 다룰까요?", options: [{ id: "concept", label: "핵심 흐름까지" }, { id: "steps", label: "실험 단계까지" }], recommendedId: "steps", reason: "팀원들이 직접 따라 해볼 수 있어요." } } : input.action === "outline" ? { version: 1, action: "seminar_outline", message: "기획을 세 장의 흐름으로 구성했어요.", brief: {}, outline } : { version: 1, action: "seminar_draft", draft: input.action === "revise" ? { ...deck, title: "재현을 강조한 라우팅 세미나" } : deck };
      const workspace = acceptSeminarDecision(queued, decision, pages, []);
      task = { ...task, version: task.version+2, revision: task.revision+1, workspace, seminarDraft: workspace.deck, status: workspace.deck ? "waiting_review" : "waiting_input", phase: `seminar_${workspace.stage}`, canSave: Boolean(workspace.deck) };
    } else if (method === "POST" && path.endsWith("/save")) {
      const body = route.request().postDataJSON(); saved++;
      task = { ...task, version: task.version+1, seminarDraft: body.seminar, workspace: { ...task.workspace!, deck: body.seminar }, status: "completed", phase: "presentation_saved", canSave: false, savedPresentation: { id: "ui-pt-presentation", href: "/presentations/ui-pt-presentation", verified: true }, goalVerified: true };
    }
    await route.fulfill({ status: method === "POST" ? 202 : 200, json: { data: method === "GET" && path.endsWith("/tasks") ? [] : task } });
  });
  return { saved: () => saved, turns: () => turns };
}

for (const width of [1280, 390]) test(`${width}px 전용 PT 공간에서 논문→방향→대화→목차→도식 슬라이드→등록을 이어간다`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const fixture = await setup(page);
  await page.goto("/presentations");
  await page.getByRole("link", { name: "세미나 자료 만들기", exact: true }).click();
  await expect(page).toHaveURL(/\/presentations\/new$/);
  await page.getByRole("combobox", { name: "발표할 논문" }).selectOption("local-agent-paper");
  await page.getByRole("button", { name: "논문 읽고 시작하기" }).click();
  // The first development RSC request compiled and returned in 6.4s in the isolated run.
  await expect(page).toHaveURL(/\/presentations\/create\/seminar-ui-task$/,{ timeout: 15_000 });
  await page.getByRole("button", { name: "이 방향으로 준비", exact: true }).first().click();
  await expect(page.getByText("재현 설명은 어디까지 다룰까요?", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "PT 에이전트에게 말하기" }).fill("실험을 직접 따라할 수 있게 설명하자");
  await page.getByRole("button", { name: "답변 보내기", exact: true }).click();
  await expect(page.getByText("재현을 강조하는 요청을 기획에 반영했어요.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "지금 기획으로 목차 만들기" }).click();
  await expect(page.getByRole("heading", { name: "발표 목차와 시각자료 계획" })).toBeVisible();
  expect(fixture.saved()).toBe(0);
  await page.getByRole("button", { name: "이 목차로 PT 만들기" }).click();
  await expect(page.getByRole("img", { name: "원문을 바탕으로 재구성한 설명 도식" })).toBeVisible();
  await page.getByRole("textbox", { name: "PT 에이전트에게 말하기" }).fill("재현을 강조하는 제목으로 고쳐줘");
  await page.getByRole("button", { name: "답변 보내기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "재현을 강조한 라우팅 세미나", exact: true })).toBeVisible();
  expect(fixture.turns().at(-1)).toMatchObject({ action: "revise", reviewedDraft: { title: "희소 라우팅 연구 세미나" } });
  await expect(page.getByRole("button",{ name: "검토한 세미나 등록",exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "HTML/PDF 준비", exact: true }).click();
  await expect(page.getByRole("link", { name: "HTML 다운로드", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "PDF 다운로드", exact: true })).toBeVisible();
  expect(fixture.saved()).toBe(0);
  await page.screenshot({ path: test.info().outputPath(`pt-workspace-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "재현을 강조한 라우팅 세미나", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "검토한 세미나 등록", exact: true }).click();
  await expect(page.getByRole("link", { name: "등록한 발표 자료 보기 →", exact: true })).toBeVisible();
  expect(fixture.saved()).toBe(1);
});
