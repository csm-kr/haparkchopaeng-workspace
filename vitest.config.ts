import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // 프로토타입(src/)·E2E(tests/e2e)·git worktree(.claude/worktrees)는 단위 테스트 대상에서 제외.
    exclude: ["node_modules", "src", "tests/e2e", "tests/integration", "prisma/__tests__", ".next", ".claude", "connector", "scripts/**/*.test.mjs"],
    env: {
      DATABASE_URL: "postgresql://blocked:blocked@127.0.0.1:1/hapark_unit_no_database",
      DIRECT_URL: "postgresql://blocked:blocked@127.0.0.1:1/hapark_unit_no_database",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
