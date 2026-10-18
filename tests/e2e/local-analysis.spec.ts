import { expect, test } from "@playwright/test";
import type { LocalAgentDeviceView } from "../../types/local-agent";

// Only UI REST fixtures. No PDF fetch, external AI, native protocol launch, or paper mutation.
test("논문 분석은 실제 모델 선택 후 접수하고 중단할 수 있다", async ({ page }, testInfo) => {
  expect((await page.request.post("/api/auth/login", { data: { email: "de8167@gmail.com" } })).ok()).toBeTruthy();
  const now = new Date().toISOString();
  const device: LocalAgentDeviceView = { id: "analysis-fixture-pc", name: "검증 PC", platform: "windows", online: true, lastSeenAt: now, leaseExpiresAt: new Date(Date.now() + 45000).toISOString(), providers: [{ provider: "codex", status: "ready", models: [{ id: "actual-fixture-model", name: "감지된 분석 모델" }], quota: null, observedAt: now }] };
  await page.route("**/api/local-agent/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/status") ? { device, devices: [device], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 } : path.endsWith("/web-heartbeat") ? { leaseExpiresAt: device.leaseExpiresAt } : { releases: [] };
    await route.fulfill({ json: { data } });
  });
  let requests = 0, cancelled = false;
  let state = { analysisStatus: "awaiting_ai", runId: null as string | null, canCancel: false, analysisError: null as string | null };
  await page.route("**/api/papers/local-agent-paper/reanalyze", async route => {
    if (route.request().method() === "POST") {
      requests++;
      expect(route.request().postDataJSON()).toMatchObject({ deviceId: device.id, provider: "codex", model: "actual-fixture-model" });
      state = { analysisStatus: "pending", runId: "analysis-fixture-run", canCancel: true, analysisError: null };
    } else if (route.request().method() === "DELETE") {
      cancelled = true;
      state = { ...state, analysisStatus: "awaiting_ai", canCancel: false, analysisError: "분석을 중단했어요." };
    }
    await route.fulfill({ json: { data: state } });
  });
  await page.goto("/papers/local-agent-paper");
  const card = page.locator("#local-paper-analysis");
  await expect(card.getByRole("button", { name: "이 AI로 분석", exact: true })).toBeDisabled();
  expect(requests).toBe(0);
  await card.getByRole("button", { name: "모델을 선택하세요", exact: true }).click();
  await page.getByRole("option", { name: /감지된 분석 모델/ }).click();
  await card.getByRole("button", { name: "이 AI로 분석", exact: true }).click();
  await expect(card.getByText(/연결한 AI가 분석하고 있어요/)).toBeVisible();
  expect(requests).toBe(1);
  await card.screenshot({ path: testInfo.outputPath("local-paper-analysis.png") });
  await card.getByRole("button", { name: "분석 중단", exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText("분석을 중단했어요.");
  expect(cancelled).toBe(true);
});
