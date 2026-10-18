import { expect, test, type Page } from "@playwright/test";
import type { LocalAgentDeviceView } from "../../types/local-agent";
import type { ResearchChatTurn, ResearchConversationView, ResearchPaperOption } from "../../types/research-chat";

// UI fixtures only. Chat/connector requests never reach a CLI or mutate papers.
const papers: ResearchPaperOption[] = [
  { id: "chat-fixture-1", title: "연구 논문 A", sourceReady: true },
  { id: "chat-fixture-2", title: "연구 논문 B", sourceReady: true },
  { id: "chat-fixture-3", title: "연구 논문 C", sourceReady: true },
  { id: "chat-fixture-4", title: "연구 논문 D", sourceReady: true },
];
const now = new Date().toISOString();
const device: LocalAgentDeviceView = { id: "chat-fixture-pc", name: "연구용 PC", platform: "windows", online: true, lastSeenAt: now, leaseExpiresAt: new Date(Date.now() + 45000).toISOString(), providers: [{ provider: "codex", status: "ready", models: [{ id: "fixture-model", name: "감지된 연구 모델" }], quota: { short: null, weekly: { label: "7일 한도", remainingPercent: 44, resetsAt: null } }, observedAt: now }] };

async function setup(page: Page) {
  const login = await page.request.post("/api/auth/login", { data: { email: "de8167@gmail.com" } });
  expect(login.ok()).toBeTruthy();
  await page.addInitScript(() => Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false } }));
  let conversation: ResearchConversationView | null = null;
  let turn: ResearchChatTurn | null = null;
  let creates = 0, sends = 0, cancelled = false, expired = false;
  await page.route("**/api/local-agent/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/status") ? { device, devices: [device], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 } : path.endsWith("/web-heartbeat") ? { leaseExpiresAt: device.leaseExpiresAt } : path.endsWith("/downloads") ? { releases: [] } : null;
    await route.fulfill({ status: data ? 200 : 404, json: data ? { data } : { error: { code: "NOT_FOUND", message: "테스트에 없는 요청" } } });
  });
  await page.route("**/api/research-chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (expired) { await route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "로그인이 필요해요." } } }); return; }
    let data: unknown;
    if (path.endsWith("/papers")) data = papers;
    else if (path.endsWith("/sources") && method === "POST") data = { accepted: true };
    else if (path.endsWith("/conversations") && method === "GET") data = conversation ? [conversation] : [];
    else if (path.endsWith("/conversations") && method === "POST") {
      creates += 1;
      const body = route.request().postDataJSON();
      conversation = { id: "chat-fixture-conversation", title: body.title, paperIds: body.paperIds, createdAt: now, updatedAt: now }; data = conversation;
    } else if (path.endsWith("/turns") && method === "POST" && conversation) {
      sends += 1;
      const body = route.request().postDataJSON();
      turn = { id: "chat-fixture-turn", version: 1, conversationId: conversation.id, conversationTurn: 1, canCancel: true, contextTruncated: true, paperId: conversation.paperIds[0], provider: body.provider, model: body.model, prompt: body.prompt, status: "queued", response: "", error: null, createdAt: now, updatedAt: now }; data = turn;
    } else if (path.endsWith("/cancel") && turn) { cancelled = true; turn = { ...turn, version: 3, status: "cancelled", response: "원문에 근거한 부분 답변", error: null }; data = turn; }
    else if (conversation && path.endsWith(`/conversations/${conversation.id}`)) {
      if (turn && !cancelled) turn = { ...turn, version: 2, status: "running", response: "원문에 근거한 부분 답변" };
      data = { conversation, papers: papers.filter((paper) => conversation!.paperIds.includes(paper.id)), turns: turn ? [turn] : [], hasEarlierTurns: false };
    } else { await route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "테스트에 없는 대화" } } }); return; }
    await route.fulfill({ status: 200, json: { data } });
  });
  return { creates: () => creates, sends: () => sends, expire: () => { expired = true; } };
}

async function choosePaper(page: Page) {
  await page.getByRole("button", { name: /팀 논문 선택/ }).click();
  const picker = page.getByRole("dialog", { name: "팀 논문 선택", exact: true });
  await picker.getByRole("checkbox", { name: /연구 논문 A/ }).check();
  await picker.getByRole("button", { name: "논문 선택 완료" }).click();
}
async function chooseModel(page: Page) {
  await page.getByRole("button", { name: "모델을 선택하세요", exact: true }).click();
  await page.getByRole("option", { name: /감지된 연구 모델/ }).click();
}

test("개인 연구 대화는 논문·실제 모델 선택 후 누적 답변과 취소를 보관한다", async ({ page }) => {
  const fixture = await setup(page);
  await page.goto("/ai-chat");
  await expect(page.getByRole("link", { name: "AI 채팅", exact: true })).toHaveAttribute("aria-current", "page");
  await choosePaper(page);
  await page.getByRole("button", { name: "논문 요약", exact: true }).click();
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  await chooseModel(page);
  const quota = page.getByRole("button", { name: "사용량 상세" });
  await expect(quota.getByTestId("usage-ring")).toHaveAttribute("width", "20");
  await quota.hover(); await expect(page.getByRole("tooltip")).toContainText("44% 남음");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page).toHaveURL(/\/ai-chat\/chat-fixture-conversation$/);
  await expect(page.getByText("원문에 근거한 부분 답변", { exact: true })).toBeVisible();
  await expect(page.getByText(/분량 제한으로/)).toBeVisible();
  await page.getByRole("button", { name: "답변 중지", exact: true }).click();
  await expect(page.getByText("답변을 중지했어요.")).toBeVisible();
  expect(fixture.creates()).toBe(1); expect(fixture.sends()).toBe(1);
  await page.getByRole("region", { name: "AI 연구 채팅" }).screenshot({ path: test.info().outputPath("research-chat-desktop.png") });
  await page.getByRole("button", { name: "새 대화", exact: true }).click();
  await expect(page.getByRole("button", { name: "논문 요약", exact: true })).toBeVisible();
  if (await page.getByRole("button", { name: "대화 목록 열기" }).isVisible()) await page.getByRole("button", { name: "대화 목록 열기" }).click();
  await page.getByRole("button", { name: /선택한 논문별 문제/ }).click();
  await expect(page.getByText("원문에 근거한 부분 답변", { exact: true })).toBeVisible();
  expect(fixture.sends()).toBe(1);
});

test("390px에서도 논문 선택·입력이 잘리지 않고 목록 모달은 포커스를 돌려준다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page); await page.goto("/ai-chat");
  await expect(page.getByRole("button", { name: "사이드바 펼치기" })).toBeVisible();
  const entry = page.getByRole("button", { name: "대화 목록 열기" });
  await entry.click(); await expect(page.getByRole("dialog", { name: "대화 목록", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(entry).toBeFocused();
  await page.getByRole("button", { name: /팀 논문 선택/ }).click();
  const picker = page.getByRole("dialog", { name: "팀 논문 선택", exact: true });
  await picker.getByRole("checkbox", { name: /연구 논문 A/ }).check();
  await picker.getByRole("checkbox", { name: /연구 논문 B/ }).check();
  await picker.getByRole("checkbox", { name: /연구 논문 C/ }).check();
  await expect(picker.getByRole("checkbox", { name: /연구 논문 D/ })).toBeDisabled();
  const box = await picker.boundingBox(); expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await picker.getByRole("button", { name: "논문 선택 완료" }).click();
  await expect(page.getByRole("textbox", { name: "연구 질문" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeInViewport();
  await page.getByRole("region", { name: "AI 연구 채팅" }).screenshot({ path: test.info().outputPath("research-chat-mobile.png") });
});

test("웹 세션이 끝나면 연결된 PC가 있어도 대화 응답을 지우고 재로그인한다", async ({ page }) => {
  const fixture = await setup(page); await page.goto("/ai-chat");
  await choosePaper(page); await chooseModel(page);
  await page.getByRole("textbox", { name: "연구 질문" }).fill("논문의 핵심 기여를 설명해 주세요.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("원문에 근거한 부분 답변", { exact: true })).toBeVisible();
  fixture.expire();
  await expect(page.getByRole("link", { name: "다시 로그인", exact: true })).toBeVisible();
  await expect(page.getByText("원문에 근거한 부분 답변", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  expect(fixture.sends()).toBe(1);
});
