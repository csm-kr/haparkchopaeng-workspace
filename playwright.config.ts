import { defineConfig } from "@playwright/test";
import { assertTestDatabase } from "./scripts/test-database";

const databaseUrl = assertTestDatabase();

// E2E: webServer로 앱을 자동 기동해 헤드리스로 핵심 경로만 검증한다.
// npm run test:e2e가 생성한 로컬 전용 DB만 사용한다.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "on-first-retry",
  },
  webServer: {
    // next dev로 띄운다: NODE_ENV !== "production"이라 /api/auth/login(dev 로그인)이 동작한다.
    // 프로덕션 빌드는 이 라우트를 404로 막아 e2e 로그인이 불가하다(ADR-017).
    command: `node scripts/test-web-server.mjs ${PORT}`,
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: false,
    // dev(NODE_ENV=development)는 PAPER_WEEKLY_LIMIT 미설정 시 0(무제한)이라 업로드 모달의
    // "이번 주 분석 N/M" 한도 표시가 숨겨진다(lib/rate-limit·quota.limit>0 게이트). e2e가 한도
    // 표시를 검증할 수 있게 운영과 동일한 20을 주입한다(데이터 무관: remaining>0 유지 → 다른 분기 불변).
    env: { PAPER_WEEKLY_LIMIT: "20", DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
  },
});
