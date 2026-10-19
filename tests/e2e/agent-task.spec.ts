import { expect, test, type Page } from "@playwright/test";
import type { AgentSeminarDraft, AgentTaskView } from "../../types/agent-task";
import type { LocalAgentDeviceView } from "../../types/local-agent";

// UI contract fixtures. Real queue, grant, source and note persistence use isolated DB integration tests.
async function setup(page: Page, kind: "note" | "seminar" = "note") {
  expect((await page.request.post("/api/auth/login", { data: { email: "de8167@gmail.com" } })).ok()).toBeTruthy();
  const now = new Date().toISOString();
  const device: LocalAgentDeviceView = { id: "agent-ui-pc", name: "검증 PC", platform: "windows", online: true, lastSeenAt: now, leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(), providers: [{ provider: "codex", status: "ready", models: [{ id: "actual-model", name: "확인한 모델" }], quota: null, observedAt: now, capabilities: ["agent_step_v1"] }] };
  await page.addInitScript(() => Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false } }));
  await page.route("**/api/local-agent/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/status") ? { device, devices: [device], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 } : path.endsWith("/web-heartbeat") ? { leaseExpiresAt: device.leaseExpiresAt } : { releases: [] };
    await route.fulfill({ json: { data } });
  });
  await page.route("**/api/research-chat/papers", route => route.fulfill({ json: { data: [{ id: "local-agent-paper", title: "격리 검증용 논문", sourceReady: true }] } }));
  await page.route("**/api/research-chat/presentations", route => route.fulfill({ json: { data: [] } }));
  let task: AgentTaskView | null = null, creates = 0, saves = 0;
  let reviewed: Record<string, unknown> | null = null;
  const seminar: AgentSeminarDraft = { title: "논문으로 준비한 세미나", durationMinutes: 30, summary: "방법과 한계를 함께 토론해요.", keypoints: ["핵심 기여", "실험 한계"], slides: [{ title: "문제와 배경", body: "연구 질문과 배경" }, { title: "제안 방법", body: "희소 라우팅으로 메모리 사용량을 줄인다." }, { title: "토론 질문", body: "비교 조건이 바뀌면 결과가 달라질까요?" }], citations: [{ page: 1, quote: "The method reduces memory through sparse routing." }] };
  await page.route("**/api/agent/tasks**", async route => {
    const method = route.request().method(), path = new URL(route.request().url()).pathname;
    if (method === "POST" && path.endsWith("/save") && task) {
      reviewed = route.request().postDataJSON(); saves++;
      task = { ...task, version: 4, phase: "saved", status: "completed", goalVerified: true, canSave: false, canResume: false,
        ...(kind === "seminar" ? { seminarDraft: reviewed!.seminar as AgentSeminarDraft, savedPresentation: { id: "fixture-seminar", href: "/presentations/fixture-seminar", verified: true } } : { draft: { ...task.draft!, title: String(reviewed!.title), body: String(reviewed!.body) }, savedNote: { id: "fixture-note", href: "/papers/local-agent-paper#section-contributions", verified: true } }) };
    } else if (method === "POST" && path.endsWith("/tasks")) {
      creates++; const body = route.request().postDataJSON();
      task = { id: "ui-task", kind, conversationId: null, version: 1, revision: 0, goal: body.goal, status: "queued", phase: "queued", paper: { id: body.paperId, title: "격리 검증용 논문" }, draft: null, savedNote: null, error: null, goalVerified: false, canCancel: true, canSave: false, canResume: false, decisionCount: 0, toolCount: 0, createdAt: now, updatedAt: now, activity: [] };
    } else if (method === "GET" && task?.status === "queued") {
      task = { ...task, version: 3, status: "completed", phase: "draft_ready", canCancel: false, canSave: true, canResume: true, goalVerified: true, decisionCount: 2, toolCount: 1,
        draft: { title: "Contribution 토론", body: "원문 p.1에서 확인한 방법과 한계\n\n토론 질문\n1. 어떤 조건에서 결과가 달라질까요?", lens: "research", sectionId: "contributions", citations: [{ page: 1, quote: "The method reduces memory through sparse routing." }] },
        activity: [{ id: "read", label: "원문 읽기", status: "completed", at: now }] };
      if (kind === "seminar") task = { ...task, draft: null, seminarDraft: seminar, status: "waiting_review", goalVerified: false };
    }
    await route.fulfill({ status: method === "POST" ? 202 : 200, json: { data: method === "GET" && path.endsWith("/tasks") ? task ? [task] : [] : task } });
  });
  return { creates: () => creates, saves: () => saves, reviewed: () => reviewed };
}

for (const width of [1280, 390]) test(`${width}px에서 원문 근거를 검토하고 노트를 명시적으로 저장하며 새로고침 후 결과를 복원한다`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const fixture = await setup(page);
  await page.goto("/ai-chat?paperId=local-agent-paper");
  await page.getByRole("textbox", { name: "연구 질문" }).fill("이 논문의 기여와 한계를 읽고 발표용 토론 노트 초안을 만들어줘");
  await page.getByRole("button", { name: "노트 초안 만들기", exact: true }).click();
  await expect(page.getByText("초안 완료", { exact: true })).toBeVisible();
  expect(fixture.creates()).toBe(1); expect(fixture.saves()).toBe(0);
  await page.getByText("원문 근거 1개", { exact: true }).click();
  await expect(page.getByText("The method reduces memory through sparse routing.", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "노트 본문" }).fill("검토 후 수정한 실제 저장 본문");
  await page.getByRole("button", { name: "검토한 내용 저장", exact: true }).click();
  await expect(page.getByText("저장 확인 완료", { exact: true })).toBeVisible();
  expect(fixture.reviewed()).toMatchObject({ expectedVersion: 3, body: "검토 후 수정한 실제 저장 본문" });
  await expect(page.getByRole("link", { name: "저장한 노트 보기", exact: true })).toHaveAttribute("href", "/papers/local-agent-paper#section-contributions");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`agent-task-${width}.png`), fullPage: true });
  await page.reload();
  await expect(page.getByText("검토 후 수정한 실제 저장 본문", { exact: true })).toBeVisible();
  expect(fixture.saves()).toBe(1);
});

for (const width of [1280, 390]) test(`${width}px에서 발표 자료 목록의 세미나 생성으로 들어가 슬라이드를 검토하고 등록한다`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const fixture = await setup(page, "seminar");
  await page.goto("/ai-chat?work=seminar");
  await expect(page.getByRole("heading", { name: "어떤 논문으로 세미나를 준비할까요?" })).toBeVisible();
  await page.getByRole("textbox", { name: "연구 질문" }).fill("@격리");
  await page.getByRole("option", { name: /격리 검증용 논문/ }).click();
  await page.getByRole("button", { name: "세미나 자료 만들기", exact: true }).click();
  await expect(page.getByText("초안 검토 대기", { exact: true })).toBeVisible();
  expect(fixture.creates()).toBe(1); expect(fixture.saves()).toBe(0);
  await page.getByRole("textbox", { name: "세미나 제목" }).fill("검토한 세미나 제목");
  await page.getByText("핵심 내용과 슬라이드 수정", { exact: true }).click();
  await page.getByRole("textbox", { name: "3번 슬라이드 내용" }).fill("검토한 토론 질문: 비교 실험을 어떻게 재현할까요?");
  await page.getByRole("button", { name: "검토한 세미나 등록", exact: true }).click();
  await expect(page.getByText("세미나 등록 확인 완료", { exact: true })).toBeVisible();
  expect(fixture.reviewed()).toMatchObject({ expectedVersion: 3, seminar: { title: "검토한 세미나 제목", slides: [{ title: "문제와 배경", body: "연구 질문과 배경" }, { title: "제안 방법", body: "희소 라우팅으로 메모리 사용량을 줄인다." }, { title: "토론 질문", body: "검토한 토론 질문: 비교 실험을 어떻게 재현할까요?" }] } });
  await expect(page.getByRole("link", { name: "등록한 세미나 보기", exact: true })).toHaveAttribute("href", "/presentations/fixture-seminar");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`agent-seminar-${width}.png`), fullPage: true });
  await page.reload();
  await expect(page.getByRole("heading", { name: "검토한 세미나 제목", exact: true })).toBeVisible();
  expect(fixture.saves()).toBe(1);
});
