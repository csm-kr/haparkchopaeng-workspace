import { expect, test, type Page } from "@playwright/test";
import type { LocalAgentActiveJobView, LocalAgentAttemptCreated, LocalAgentDeviceView } from "../../types/local-agent";
import type { ConnectorRelease } from "../../components/local-agent/client";

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

async function mockConnector(page: Page, connected = false, currentDevice: LocalAgentDeviceView = device, releases: ConnectorRelease[] = []) {
  let attempts = 0;
  let downloadRequests = 0;
  let cancelled = false;
  let acknowledged = false;
  let serverNow = Date.now();
  currentDevice = { ...currentDevice, lastSeenAt: new Date(serverNow).toISOString(), leaseExpiresAt: new Date(serverNow + 45_000).toISOString() };
  let attempt: LocalAgentAttemptCreated | null = null;
  let jobs: LocalAgentActiveJobView[] = [];
  const terminals: string[] = [];
  // Date는 서버 fixture와 함께 이동하고, 실제 폴링·카운트다운 interval은 계속 실행한다.
  await page.clock.setFixedTime(serverNow);
  await page.addInitScript(() => {
    // 테스트 중 실제 OS 전용 링크를 실행하지 않는다. 제품은 실제 사용자 클릭 앵커를 제공한다.
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false, hasBeenActive: true } });
  });
  await page.route("**/api/local-agent/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let data: unknown;
    if (path.endsWith("/status")) data = { devices: connected ? [currentDevice] : [], device: connected ? currentDevice : null, leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 };
    else if (path.endsWith("/web-heartbeat")) data = { leaseExpiresAt: new Date(serverNow + 45000).toISOString() };
    else if (path.endsWith("/downloads")) { downloadRequests += 1; data = { releases }; }
    else if (path.endsWith("/jobs") && method === "GET") data = jobs;
    else if (/\/jobs\/[^/]+\/cancel$/.test(path) && method === "POST") { const id = path.split("/").at(-2); jobs = jobs.filter(job => job.id !== id); data = {}; }
    else if (path.endsWith("/terminal") && method === "POST") { terminals.push(route.request().postDataJSON().provider); data = { requestId: `ui-terminal-${terminals.length}`, expiresAt: new Date(serverNow + 30_000).toISOString() }; }
    else if (path.endsWith("/attempts") && method === "POST") {
      attempts += 1;
      cancelled = false;
      acknowledged = false;
      const id = `ui-attempt-${attempts}`;
      attempt = {
        id, version: 1, status: "awaiting_app", code: attempts === 1 ? "048217" : "593604", device: null,
        expiresAt: new Date(serverNow + 300000).toISOString(), launchToken: "opaque-ui-launch",
        deepLink: `hapark-connect://connect?attemptId=${id}&launchToken=opaque-ui-launch`,
      };
      data = attempt;
    }
    else if (attempt && path.endsWith(`/attempts/${attempt.id}`) && method === "DELETE") { cancelled = true; data = { cancelled: true }; }
    else if (attempt && path.endsWith(`/attempts/${attempt.id}`)) {
      const status = cancelled ? "cancelled" : Date.parse(attempt.expiresAt) <= serverNow ? "expired" : acknowledged ? "awaiting_code" : "awaiting_app";
      data = { ...attempt, status, code: ["cancelled", "expired"].includes(status) ? null : attempt.code, version: cancelled || status === "expired" ? 3 : acknowledged ? 2 : 1 };
    }
    else { await route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "준비되지 않은 테스트 요청" } } }); return; }
    await route.fulfill({ status: 200, json: { data } });
  });
  return {
    attempts: () => attempts,
    cancelled: () => cancelled,
    downloadRequests: () => downloadRequests,
    terminals: () => [...terminals],
    setJobs: (next: LocalAgentActiveJobView[]) => { jobs = next; },
    updateDevice: (patch: Partial<LocalAgentDeviceView>) => { currentDevice = { ...currentDevice, ...patch }; },
    acknowledge: () => {
      if (!attempt) throw new Error("연결 시도를 만든 뒤 앱 ACK를 보내야 합니다.");
      if (!acknowledged) {
        acknowledged = true;
        // 서버의 첫 앱 ACK가 번호 입력 기한을 새로 5분으로 설정한다.
        attempt = { ...attempt, expiresAt: new Date(serverNow + 300000).toISOString() };
      }
    },
    advanceTime: async (milliseconds: number) => {
      serverNow += milliseconds;
      await page.clock.setFixedTime(serverNow);
    },
  };
}

test("연결 전 설정에는 설치와 앱 열기 선택지를 표시한다", async ({ page }) => {
  await login(page);
  const connector = await mockConnector(page);
  await page.goto("/profile");
  const entry = page.getByRole("complementary").getByRole("button", { name: "AI 연결", exact: true });
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
  await expect(dialog.getByRole("heading", { name: "내 PC의 AI를 연결해요", exact: true })).toBeVisible();
  await expect(dialog.getByText("처음 사용", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "설치 파일 받기", exact: true })).toBeEnabled();
  await expect(dialog.getByText("이미 설치함", { exact: true })).toBeVisible();
  const openBridge = dialog.getByRole("button", { name: "AI 브릿지 열기", exact: true });
  await expect(openBridge).toBeEnabled();
  await expect(dialog.getByRole("tablist")).toHaveCount(0);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await expect(dialog.getByText("Effort", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("region", { name: "AI 브릿지 버전" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "완료", exact: true })).toHaveCount(0);
  expect(connector.attempts()).toBe(0);
  expect(connector.downloadRequests()).toBe(0);
  await dialog.screenshot({ path: test.info().outputPath("connection-settings-simple.png") });
  await expect(dialog.getByRole("button", { name: "연결창 닫기", exact: true })).toBeFocused();
  for (const height of [844, 420]) {
    await page.setViewportSize({ width: 390, height });
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("연결창의 화면 경계를 확인할 수 없어요.");
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(374);
    expect(box.y).toBeGreaterThanOrEqual(16);
    expect(box.y + box.height).toBeLessThanOrEqual(height - 16);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "설치 파일 받기", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(openBridge).toBeFocused();
    await expect(openBridge).toBeInViewport({ ratio: 0.99 });
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "연결창 닫기", exact: true })).toBeFocused();
  }
  await dialog.screenshot({ path: test.info().outputPath("connection-settings-simple-mobile.png") });
  expect(connector.attempts()).toBe(0);
  expect(connector.downloadRequests()).toBe(0);
  await openBridge.click();
  await expect(dialog.getByRole("heading", { name: "AI 브릿지를 열고 있어요", exact: true })).toBeVisible();
  expect(connector.attempts()).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test("사이드바 점·도구별 모델과 effort·실제 설치 버전 갱신을 함께 표시한다", async ({ page }) => {
  await login(page);
  const controlled: LocalAgentDeviceView = { ...device, bridgeVersion: null, bridgeArchitecture: null, providers: [
    { ...device.providers[0], models: [{ id: "codex-fixture", name: "Codex 실제 목록 fixture", reasoningEfforts: ["low", "high"] }] },
    { provider: "claude", status: "ready", models: [{ id: "claude-fixture", name: "Claude 실제 목록 fixture", reasoningEfforts: ["low", "medium", "high"] }], quota: null, observedAt: new Date().toISOString() },
  ] };
  const release: ConnectorRelease = { platform: "windows", architecture: "x64", version: "0.1.5", url: "https://downloads.example/AI-Bridge-0.1.5.exe", filename: "AI-Bridge-0.1.5.exe", unsigned: true };
  const connector = await mockConnector(page, true, controlled, [release]);
  await page.route(release.url, route => route.fulfill({ status: 200, headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="AI-Bridge-0.1.5.exe"' }, body: "UI download fixture; not an executable" }));
  await page.goto("/profile");
  await page.getByRole("group", { name: "테마 선택" }).getByRole("button", { name: /다크/ }).click();
  const entry = page.getByRole("complementary").getByRole("button", { name: "AI 연결", exact: true });
  const dot = entry.locator("[data-connection-state]");
  await expect(dot).toHaveAttribute("data-connection-state", "connected");
  await expect(dot).toHaveClass(/bg-online/);
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
  const model = dialog.getByRole("combobox", { name: "모델", exact: true });
  await expect(dialog.getByRole("tab", { name: "Codex", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(model.locator("option")).toHaveText(["Codex 실제 목록 fixture"]);
  await dialog.getByRole("tab", { name: "Claude Code", exact: true }).click();
  await expect(model).toHaveValue("");
  await expect(model.locator("option")).toHaveText(["모델을 선택해 주세요", "Claude 실제 목록 fixture"]);
  await model.selectOption("claude:claude-fixture");
  await dialog.getByRole("radio", { name: "high", exact: true }).check();
  await expect(dialog.getByRole("radio", { name: "high", exact: true })).toBeChecked();
  await expect(dialog.getByText("연결된 PC의 최신 버전을 확인할 수 없어요", { exact: true })).toBeVisible();
  const update = dialog.getByRole("link", { name: "업데이트 받기", exact: true });
  await expect(update).toHaveAttribute("href", release.url);
  const downloaded = page.waitForEvent("download");
  await update.click();
  expect((await downloaded).suggestedFilename()).toBe(release.filename);
  await expect(dialog.getByText(/설치 파일을 요청했어요\. 브라우저의 다운로드 목록에서 파일을 열어 설치해 주세요/)).toBeVisible();
  await expect(dialog.getByText("연결된 PC의 최신 버전을 확인할 수 없어요", { exact: true })).toBeVisible();
  connector.updateDevice({ bridgeVersion: "0.1.5", bridgeArchitecture: "x64" });
  // 설치 정보와 연결 상태는 기존 15초 heartbeat 주기에 따라 자동으로 갱신된다.
  await expect(dialog.getByText("설치 0.1.5", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText("최신 버전이에요", { exact: true })).toBeVisible();
  await expect(update).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await dialog.screenshot({ path: test.info().outputPath("connection-controls-dark.png") });
  await dialog.getByRole("button", { name: "완료", exact: true }).click();
  await expect(entry).toBeFocused();
  connector.updateDevice({ online: false });
  await expect(dot).toHaveAttribute("data-connection-state", "offline", { timeout: 20_000 });
  await expect(dot).toHaveClass(/bg-fg-faint/);
});

test("연결 한 곳에서 시작하고 웹 번호·설치 안내·취소가 이어진다", async ({ page }) => {
  await login(page);
  const connector = await mockConnector(page);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.goto("/profile");
  const entry = page.getByRole("region", { name: "AI 연결", exact: true }).getByRole("button", { name: "AI 연결 관리", exact: true });
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
  await expect(dialog.getByRole("button", { name: "AI 브릿지 열기", exact: true })).toBeEnabled();
  expect(connector.attempts()).toBe(0);
  expect(connector.downloadRequests()).toBe(0);
  await dialog.getByRole("button", { name: "설치 파일 받기", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "AI 브릿지 설치", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "설치 파일 준비 중" })).toBeDisabled();
  expect(connector.downloadRequests()).toBeGreaterThan(0);
  expect(connector.attempts()).toBe(0);
  await dialog.getByRole("button", { name: "연결 방법으로 돌아가기" }).click();
  await dialog.getByRole("button", { name: "AI 브릿지 열기", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "AI 브릿지를 열고 있어요", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveCount(0);
  await expect(dialog.getByRole("timer", { name: "연결 번호 남은 시간" })).toHaveCount(0);
  await expect(dialog.getByRole("progressbar", { name: "연결 가능 시간" })).toHaveCount(0);
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  expect(connector.attempts()).toBe(1);
  expect(downloaded).toBeFalsy();
  await connector.advanceTime(120000);
  connector.acknowledge();
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveText("048 217");
  const timer = dialog.getByRole("timer", { name: "연결 번호 남은 시간" });
  const progress = dialog.getByRole("progressbar", { name: "연결 가능 시간" });
  await expect(timer).toHaveText("05:00 남음");
  await expect(progress).toHaveAttribute("aria-valuemin", "0");
  await expect(progress).toHaveAttribute("aria-valuemax", "300");
  await expect(progress).toHaveAttribute("aria-valuenow", "300");
  await connector.advanceTime(60000);
  await expect(timer).toHaveText("04:00 남음");
  await expect(progress).toHaveAttribute("aria-valuenow", "240");
  await dialog.screenshot({ path: test.info().outputPath("web-connection.png") });
  await dialog.getByRole("button", { name: "연결 취소" }).click();
  expect(connector.cancelled()).toBe(true);
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveCount(0);
  await expect(timer).toHaveCount(0);
  await expect(progress).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test("실제 한도 창만 작은 링으로 표시하고 모델은 직접 고른다", async ({ page }) => {
  await login(page);
  await mockConnector(page, true);
  await page.goto("/profile");
  const card = page.getByRole("region", { name: "AI 연결", exact: true });
  await card.screenshot({ path: test.info().outputPath("web-agent-card.png") });
  await expect(card.getByRole("combobox")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "질문 보내기" })).toHaveCount(0);
  await card.getByRole("button", { name: "AI 연결 관리", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
  const ring = dialog.getByTestId("usage-ring");
  await expect(ring).toHaveCount(1);
  await expect(ring).toHaveAttribute("width", "20");
  const quota = dialog.getByRole("button", { name: "사용량 상세" });
  await quota.hover();
  await expect(page.getByRole("tooltip")).toContainText("44% 남음");
  await expect(page.getByRole("tooltip")).not.toContainText("5시간");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  const model = dialog.getByRole("combobox", { name: "모델", exact: true });
  await expect(model.locator("option")).toHaveText(["감지된 연구 모델"]);
  await dialog.getByRole("tab", { name: "Claude Code", exact: true }).click();
  await expect(model).toBeDisabled();
  await expect(model.locator("option")).toHaveText(["사용 가능한 모델이 없어요"]);
  await dialog.getByRole("tab", { name: "Codex", exact: true }).click();
  await model.selectOption("codex:detected-model");
  await expect(dialog.getByText("다음 질문 · Codex · 감지된 연구 모델", { exact: true })).toBeVisible();
  await dialog.screenshot({ path: test.info().outputPath("web-model-management.png") });
  await dialog.getByRole("button", { name: "완료", exact: true }).click();
  await expect(card.getByRole("button", { name: "AI 연결 관리", exact: true })).toBeFocused();
});

test("좁은 화면·다크 테마에서도 연결창이 화면 안에 있고 포커스가 순환한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const connector = await mockConnector(page);
  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "사이드바 펼치기" })).toBeVisible();
  await expect(page.getByRole("region", { name: "AI 연결", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "테마 선택" }).getByRole("button", { name: /다크/ }).click();
  await page.getByRole("region", { name: "AI 연결", exact: true }).getByRole("button", { name: "AI 연결 관리", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
  await dialog.getByRole("button", { name: "AI 브릿지 열기", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "AI 브릿지를 열고 있어요", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveCount(0);
  await expect(dialog.getByRole("timer", { name: "연결 번호 남은 시간" })).toHaveCount(0);
  await expect(dialog.getByRole("progressbar", { name: "연결 가능 시간" })).toHaveCount(0);
  connector.acknowledge();
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveText("048 217");
  await expect(dialog.getByRole("timer", { name: "연결 번호 남은 시간" })).toHaveText("05:00 남음");
  await expect(dialog.getByRole("progressbar", { name: "연결 가능 시간" })).toHaveAttribute("aria-valuenow", "300");
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

test("설치 앱의 웹 복귀는 한 번만 시작하고 만료 뒤 새 번호를 요청한다", async ({ page }) => {
  await login(page);
  const connector = await mockConnector(page);
  await page.goto("/profile?localAgentResume=1&keep=1");
  const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
  await expect(dialog.getByRole("heading", { name: "AI 브릿지를 열고 있어요", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "연결 취소", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveCount(0);
  const timer = dialog.getByRole("timer", { name: "연결 번호 남은 시간" });
  const progress = dialog.getByRole("progressbar", { name: "연결 가능 시간" });
  await expect(timer).toHaveCount(0);
  await expect(progress).toHaveCount(0);
  await expect(page).toHaveURL(/\/profile\?keep=1$/);
  expect(connector.attempts()).toBe(1);
  connector.acknowledge();
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveText("048 217");
  await expect(timer).toHaveText("05:00 남음");
  await connector.advanceTime(300000);
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveCount(0);
  await expect(timer).toHaveCount(0);
  await expect(progress).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "새 번호로 연결" })).toBeVisible();
  expect(connector.attempts()).toBe(1);
  await dialog.getByRole("button", { name: "새 번호로 연결" }).click();
  await expect(dialog.getByRole("heading", { name: "AI 브릿지를 열고 있어요", exact: true })).toBeVisible();
  expect(connector.attempts()).toBe(2);
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveCount(0);
  await expect(timer).toHaveCount(0);
  await expect(progress).toHaveCount(0);
  connector.acknowledge();
  await expect(dialog.getByLabel("연결 확인 번호")).toHaveText("593 604");
  await expect(timer).toHaveText("05:00 남음");
  await expect(progress).toHaveAttribute("aria-valuenow", "300");
});

for (const width of [360, 1440]) {
  test(`연결 창에서 연결된 PC의 터미널을 열고 실행 중인 채팅 답변을 멈춘다 (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await login(page);
    const connector = await mockConnector(page, true, { ...device, bridgeVersion: "0.1.13", bridgeCapabilities: ["terminal_v1"] });
    const createdAt = new Date().toISOString();
    connector.setJobs([
      { id: "ui-chat-job", kind: "chat", provider: "codex", model: "detected-model", status: "running", createdAt, href: "/ai-chat/ui-conversation", canCancel: true },
      { id: "ui-analysis-job", kind: "paper_analysis", provider: "codex", model: "detected-model", status: "queued", createdAt, href: "/papers/ui-paper#local-paper-analysis", canCancel: false },
    ]);
    await page.goto("/profile");
    await page.getByRole("region", { name: "AI 연결", exact: true }).getByRole("button", { name: "AI 연결 관리", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
    expect(connector.terminals()).toEqual([]);
    await dialog.getByRole("button", { name: "Codex 터미널 열기", exact: true }).click();
    await expect(dialog.getByText("연결된 PC(내 연구용 PC)에서 터미널을 여는 중이에요. 몇 초 안에 열려요.")).toBeVisible();
    expect(connector.terminals()).toEqual(["codex"]);
    const region = dialog.getByRole("region", { name: "실행 중인 작업" });
    await expect(region.getByRole("listitem")).toHaveCount(2);
    await expect(region.getByRole("listitem", { name: /논문 분석/ }).getByRole("button", { name: "멈추기" })).toHaveCount(0);
    await region.getByRole("listitem", { name: /AI 채팅/ }).getByRole("button", { name: "멈추기" }).click();
    await expect(region.getByRole("listitem")).toHaveCount(1);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await dialog.screenshot({ path: test.info().outputPath(`cli-panel-${width}.png`) });
  });
}
