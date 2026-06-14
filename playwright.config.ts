import { defineConfig } from "@playwright/test";

// E2E: webServer로 앱을 자동 기동해 헤드리스로 핵심 경로만 검증한다.
// dev 서버를 띄워 dev 로그인을 사용하며, DB는 공유 운영 Supabase다(로컬 dev.db 없음).
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
    // next dev로 띄운다: NODE_ENV !== "production"이라 /api/auth/login(dev 로그인)이 동작한다.
    // 프로덕션 빌드는 이 라우트를 404로 막아 e2e 로그인이 불가하다(ADR-017).
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    // dev(NODE_ENV=development)는 PAPER_WEEKLY_LIMIT 미설정 시 0(무제한)이라 업로드 모달의
    // "이번 주 분석 N/M" 한도 표시가 숨겨진다(lib/rate-limit·quota.limit>0 게이트). e2e가 한도
    // 표시를 검증할 수 있게 운영과 동일한 20을 주입한다(데이터 무관: remaining>0 유지 → 다른 분기 불변).
    env: { PAPER_WEEKLY_LIMIT: "20" },
  },
});
