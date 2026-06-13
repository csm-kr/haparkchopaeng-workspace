import { defineConfig } from "@playwright/test";

// E2E는 step5/6에서 가동한다(브라우저 미설치·화면 미구현). 여기서는 설정 골격만 둔다.
export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
});
