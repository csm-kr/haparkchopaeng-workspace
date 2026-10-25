import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Node 25+ ships its own global localStorage/sessionStorage, which shadows jsdom's and leaves
// window.localStorage undefined in tests. Turn Node's off there; Node 24 (CI) needs nothing.
const nodeMajor = Number(process.versions.node.split(".")[0]);
const execArgv = nodeMajor >= 25 ? ["--no-experimental-webstorage"] : [];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    poolOptions: { forks: { execArgv }, threads: { execArgv } },
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
