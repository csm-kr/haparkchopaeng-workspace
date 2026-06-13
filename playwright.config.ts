import { defineConfig } from "@playwright/test";

// E2E: webServer로 앱을 자동 기동해 헤드리스로 핵심 경로만 검증한다.
// dev 로그인은 시드 DB(dev.db)를 사용한다(컴포넌트/단위 검증은 Vitest+RTL).
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "on-first-retry",
  },
  webServer: {
    // 프로덕션 빌드를 띄워 안정적으로 검증(개발 HMR 변동 배제).
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
