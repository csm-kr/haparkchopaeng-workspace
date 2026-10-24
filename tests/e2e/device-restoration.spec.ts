import { expect, test, type Page } from "@playwright/test";
import type { LocalAgentAttemptCreated, LocalAgentAttemptView, LocalAgentDeviceView } from "../../types/local-agent";

// Synthetic host API only: this checks real tab storage events, not an installed app or CLI.
const modelName = "새 탭 복원 연구 모델";
const observedAt = new Date().toISOString();
const device: LocalAgentDeviceView = {
  id: "restoration-pc", name: "새 탭 검증 PC", platform: "windows", online: true,
  lastSeenAt: observedAt, leaseExpiresAt: "2099-01-01T00:00:00Z",
  bridgeVersion: "0.1.6", bridgeArchitecture: "x64",
  providers: [{ provider: "codex", status: "ready", models: [{ id: "restoration-model", name: modelName }],
    quota: { short: null, weekly: { label: "7일 한도", remainingPercent: 44, resetsAt: null } }, observedAt }],
};
const other: LocalAgentDeviceView = {
  ...device, id: "another-online-pc", name: "다른 온라인 PC",
  providers: [{ ...device.providers[0], models: [{ id: "another-model", name: "다른 PC 모델" }] }],
};

test("승인한 PC는 새 탭에서 복원되고 실제 storage 이벤트로 연결 해제가 동기화된다", async ({ page, context }, testInfo) => {
  expect((await page.request.post("/api/auth/login", { data: { email: "de8167@gmail.com" } })).ok()).toBeTruthy();
  await context.addInitScript(() => {
    // A browser test must not invoke the machine's registered native protocol.
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false, hasBeenActive: true } });
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      Reflect.set(window, "__bridgeInitialDeviceHints", Object.keys(window.sessionStorage)
        .filter(key => key.startsWith("hapark.local-agent.device:")));
    }
  });

  let attempts = 0;
  let approved = false;
  let attempt: LocalAgentAttemptCreated | null = null;
  let second: Page | null = null;
  const secondStatusIds: Array<string | null> = [];
  const unexpected: string[] = [];
  await context.route("**/api/local-agent/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    let data: unknown;
    let status = 200;
    if (url.pathname.endsWith("/status") && method === "GET") {
      const id = url.searchParams.get("deviceId");
      if (second && request.frame().page() === second) secondStatusIds.push(id);
      const devices = approved ? [other, device] : [other];
      data = { devices, device: id ? devices.find(item => item.id === id) ?? null : null,
        leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 };
    } else if (url.pathname.endsWith("/attempts") && method === "POST") {
      attempts += 1;
      attempt = {
        id: "restoration-attempt", version: 1, status: "awaiting_app", code: "123456", device: null,
        expiresAt: new Date(Date.now() + 300_000).toISOString(), launchToken: "synthetic-restoration-launch",
        deepLink: "hapark-connect://connect?attemptId=restoration-attempt&launchToken=synthetic-restoration-launch",
      };
      data = attempt;
      status = 201;
    } else if (attempt && url.pathname.endsWith(`/attempts/${attempt.id}`) && method === "GET") {
      approved = true;
      data = { id: attempt.id, version: 2, status: "connected", code: null, device,
        expiresAt: attempt.expiresAt } satisfies LocalAgentAttemptView;
    } else if (url.pathname.endsWith("/web-heartbeat") && method === "POST" && request.postDataJSON()?.deviceId === device.id) {
      data = { leaseExpiresAt: "2099-01-01T00:00:00Z" };
    } else if (url.pathname.endsWith("/downloads") && method === "GET") {
      data = { releases: [] };
    } else {
      unexpected.push(`${method} ${url.pathname}`);
      await route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "합성 검증에 없는 요청" } } });
      return;
    }
    await route.fulfill({ status, json: { data } });
  });

  await page.goto("/profile");
  await page.getByRole("group", { name: "테마 선택" }).getByRole("button", { name: /다크/ }).click();
  const firstCard = page.getByRole("region", { name: "AI 연결", exact: true });
  await expect(firstCard).not.toContainText(other.name);
  await firstCard.getByRole("button", { name: "AI 연결 관리", exact: true }).click();
  const connection = page.getByRole("dialog", { name: "AI 연결", exact: true });
  await expect(connection.getByRole("combobox", { name: "모델", exact: true })).toHaveCount(0);
  await expect(connection.getByText("다른 PC 모델", { exact: true })).toHaveCount(0);
  expect(attempts).toBe(0);
  await connection.getByRole("button", { name: "AI 브릿지 열기", exact: true }).click();
  await expect(connection.getByText("이 웹에 연결됐어요", { exact: true })).toBeVisible();
  await expect(connection.getByRole("combobox", { name: "모델", exact: true })).toBeEnabled();
  await expect(connection.getByRole("combobox", { name: "모델", exact: true }).locator("option")).toHaveText([modelName]);
  await connection.getByRole("button", { name: "완료", exact: true }).click();
  await expect(connection).toHaveCount(0);
  await expect(firstCard).toContainText(device.name);
  expect(attempts).toBe(1);

  // The active team ID is server-owned; discover only our approved, non-secret hint key.
  const sharedKey = await page.evaluate(id => Object.keys(window.localStorage).find(key => {
    if (!key.startsWith("hapark.local-agent.device:")) return false;
    try { return JSON.parse(window.localStorage.getItem(key) ?? "null")?.deviceId === id; }
    catch { return false; }
  }) ?? null, device.id);
  expect(sharedKey).not.toBeNull();
  if (!sharedKey) throw new Error("승인한 기기의 공유 힌트가 게시되지 않았어요.");
  const approvedKey = sharedKey;
  expect(await page.evaluate(key => window.sessionStorage.getItem(key), approvedKey)).toBe(device.id);

  // context.newPage has no opener and therefore starts with independent, empty sessionStorage.
  second = await context.newPage();
  await second.goto("/profile");
  expect(await second.evaluate(() => Reflect.get(window, "__bridgeInitialDeviceHints"))).toEqual([]);
  const secondCard = second.getByRole("region", { name: "AI 연결", exact: true });
  await expect(secondCard).toContainText(device.name);
  expect(secondStatusIds[0]).toBe(device.id);
  expect(await second.evaluate(key => window.sessionStorage.getItem(key), approvedKey)).toBe(device.id);
  expect(attempts).toBe(1);

  const sidebar = second.getByRole("complementary").getByRole("group", { name: "AI 연결 상태", exact: true });
  await expect(sidebar).toContainText(modelName);
  const entry = sidebar.getByRole("button", { name: "AI 연결", exact: true });
  const dot = entry.locator("[data-connection-state]");
  await expect(dot).toHaveAttribute("data-connection-state", "connected");
  const quota = sidebar.getByRole("button", { name: "현재 모델 사용량 상세", exact: true });
  await expect(sidebar.locator(":scope > button")).toHaveCount(2);
  await expect(entry.locator("button")).toHaveCount(0);
  await expect(quota.getByTestId("usage-ring")).toHaveAttribute("width", "20");
  await expect(quota.getByTestId("usage-ring")).toHaveAttribute("height", "20");
  await quota.hover();
  await expect(second.getByRole("tooltip")).toContainText("44% 남음");
  await expect(second.getByRole("tooltip")).toContainText("정확한 잔여 토큰 수를 의미하지 않아요.");
  await second.screenshot({ path: testInfo.outputPath("device-restoration-new-tab-quota-dark.png"), fullPage: true });
  await second.keyboard.press("Escape");
  await expect(second.getByRole("tooltip")).toHaveCount(0);

  await entry.click();
  const secondConnection = second.getByRole("dialog", { name: "AI 연결", exact: true });
  const secondModel = secondConnection.getByRole("combobox", { name: "모델", exact: true });
  await expect(secondModel).toBeEnabled();
  await expect(secondModel.locator("option")).toHaveText([modelName]);

  // No synthetic dispatchEvent: Chromium delivers a native StorageEvent to the second Page.
  await page.evaluate(key => window.localStorage.removeItem(key), approvedKey);
  await expect(secondModel).toHaveCount(0);
  await expect(secondConnection.getByRole("button", { name: "AI 브릿지 열기", exact: true })).toBeEnabled();
  await expect(dot).toHaveAttribute("data-connection-state", "idle");
  await expect(quota).toHaveCount(0);
  expect(await second.evaluate(key => window.sessionStorage.getItem(key), approvedKey)).toBeNull();
  expect(await second.evaluate(key => window.localStorage.getItem(key), approvedKey)).toBeNull();

  // A fresh status response still lists both online PCs, but neither becomes an implicit target.
  await second.keyboard.press("Escape");
  secondStatusIds.length = 0;
  await second.reload();
  await secondCard.getByRole("button", { name: "AI 연결 관리", exact: true }).click();
  await expect(second.getByRole("dialog", { name: "AI 연결", exact: true }).getByRole("combobox", { name: "모델", exact: true })).toHaveCount(0);
  await expect(dot).toHaveAttribute("data-connection-state", "idle");
  expect(secondStatusIds[0]).toBeNull();
  expect(attempts).toBe(1);
  expect(unexpected).toEqual([]);
});
