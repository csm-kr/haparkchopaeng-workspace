import { expect, test, type Page } from "@playwright/test";
import type { LocalAgentAttemptCreated, LocalAgentDeviceView } from "../../types/local-agent";

// 연결/작업 API는 전부 격리한다. 실제 설치·CLI 검증을 이 화면 테스트로 대체하지 않는다.
const device: LocalAgentDeviceView = {
  id: "ui-device", name: "내 연구용 PC", platform: "windows", online: true,
  lastSeenAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 45000).toISOString(),
  providers: [{ provider: "codex", status: "ready", models: [{ id: "detected-model", name: "감지된 연구 모델" }],
    quota: { short: null, weekly: { label: "7일 한도", remainingPercent: 44, resetsAt: null } }, observedAt: new Date().toISOString() }],
};

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", { data: { email: "de8167@gmail.com" } });
  expect(response.ok()).toBeTruthy();
}

async function mockConnector(page: Page, connected = false) {
  let attempts = 0;
  let cancelled = false;
  const attempt: LocalAgentAttemptCreated = {
    id: "ui-attempt", version: 1, status: "awaiting_app", code: "048217", device: null,
    expiresAt: new Date(Date.now() + 300000).toISOString(), launchToken: "opaque-ui-launch",
    deepLink: "hapark-connect://connect?attemptId=ui-attempt&launchToken=opaque-ui-launch",
  };
  await page.addInitScript(() => {
    // 테스트 중 실제 OS 전용 링크를 실행하지 않는다. 제품은 실제 사용자 클릭 앵커를 제공한다.
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false, hasBeenActive: true } });
  });
  await page.route("**/api/local-agent/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let data: unknown;
    if (path.endsWith("/status")) data = { devices: connected ? [device] : [], device: connected ? device : null, leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 };
    else if (path.endsWith("/web-heartbeat")) data = { leaseExpiresAt: new Date(Date.now() + 45000).toISOString() };
    else if (path.endsWith("/downloads")) data = { releases: [] };
    else if (path.endsWith("/attempts") && method === "POST") { attempts += 1; data = attempt; }
    else if (path.endsWith("/attempts/ui-attempt") && method === "DELETE") { cancelled = true; data = { cancelled: true }; }
    else if (path.endsWith("/attempts/ui-attempt")) data = { ...attempt, status: cancelled ? "cancelled" : "awaiting_app", version: 2 };
    else { await route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "준비되지 않은 테스트 요청" } } }); return; }
    await route.fulfill({ status: 200, json: { data } });
  });
  return { attempts: () => attempts };
}

test("연결 한 곳에서 시작하고 웹 번호·설치 안내·취소가 이어진다", async ({ page }) => {
  await login(page);
  const connector = await mockConnector(page);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.goto("/profile");
  const entry = page.getByRole("button", { name: "AI 연결", exact: true }).first();
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveText("048 217");
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "설치 파일 준비 중" })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "연결기 다시 열기" })).toHaveAttribute("href", /^hapark-connect:/);
  expect(connector.attempts()).toBe(1);
  expect(downloaded).toBeFalsy();
  await dialog.screenshot({ path: test.info().outputPath("web-connection.png") });
  await dialog.getByRole("button", { name: "연결 취소" }).click();
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test("실제 한도 창만 작은 링으로 표시하고 모델은 직접 고른다", async ({ page }) => {
  await login(page);
  await mockConnector(page, true);
  await page.goto("/profile");
  const card = page.getByRole("region", { name: "AI 연결", exact: true });
  const picker = card.getByRole("button", { name: "모델을 선택하세요" });
  await expect(picker).toBeEnabled();
  await card.screenshot({ path: test.info().outputPath("web-agent-card.png") });
  await expect(card.getByRole("button", { name: "질문 보내기" })).toBeDisabled();
  const ring = card.getByTestId("usage-ring");
  await expect(ring).toHaveCount(1);
  await expect(ring).toHaveAttribute("width", "20");
  const quota = card.getByRole("button", { name: "사용량 상세" });
  await quota.hover();
  await expect(page.getByRole("tooltip")).toContainText("44% 남음");
  await expect(page.getByRole("tooltip")).not.toContainText("5시간");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await picker.click();
  const search = page.getByRole("searchbox", { name: "모델 검색" });
  await expect(search).toBeFocused();
  await page.getByRole("listbox", { name: "사용 가능한 모델" }).locator("..").screenshot({ path: test.info().outputPath("web-model-picker.png") });
  await search.fill("감지된");
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(card.getByRole("button", { name: "Codex · 감지된 연구 모델" })).toBeFocused();
  await expect(page.getByRole("listbox", { name: "사용 가능한 모델" })).toHaveCount(0);
});

test("좁은 화면·다크 테마에서도 연결창이 화면 안에 있고 포커스가 순환한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await mockConnector(page);
  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "사이드바 펼치기" })).toBeVisible();
  await expect(page.getByRole("region", { name: "AI 연결", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "테마 선택" }).getByRole("button", { name: /다크/ }).click();
  await page.getByRole("button", { name: "AI 연결", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
  await expect(dialog.getByLabel("연결 확인 번호")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await dialog.screenshot({ path: test.info().outputPath("web-mobile-dark.png") });
  const cancel = dialog.getByRole("button", { name: "연결 취소" });
  await cancel.focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "연결창 닫기" })).toBeFocused();
});

test("설치 앱의 웹 복귀는 중복 시도 없이 연결창을 다시 연다", async ({ page }) => {
  await login(page);
  const connector = await mockConnector(page);
  await page.goto("/profile?localAgentResume=1&keep=1");
  const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveText("048 217");
  await expect(page).toHaveURL(/\/profile\?keep=1$/);
  expect(connector.attempts()).toBe(1);
});
