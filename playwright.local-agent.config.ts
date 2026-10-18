import { defineConfig } from "@playwright/test";

// scripts/local-agent-verify.mjs owns a fresh SQLite DB and the hidden app process.
if (process.env.HAPARK_ISOLATED_TESTS !== "1" || !process.env.DATABASE_URL?.startsWith("file:")) {
  throw new Error("Run npm run test:local-agent:e2e to use a disposable database.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["local-agent.spec.ts", "research-chat.spec.ts", "local-analysis.spec.ts", "device-restoration.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: { baseURL: process.env.LOCAL_AGENT_E2E_URL, headless: true, trace: "retain-on-failure" },
});
