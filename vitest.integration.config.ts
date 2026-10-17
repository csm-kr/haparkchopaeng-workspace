import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { assertTestDatabase } from "./scripts/test-database";

const url = assertTestDatabase();
export default defineConfig({
  test: {
    environment: "node",
    include: ["prisma/__tests__/seed.test.ts", "tests/integration/**/*.test.ts"],
    env: { DATABASE_URL: url, DIRECT_URL: url },
    fileParallelism: false,
    testTimeout: 15_000,
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
});
