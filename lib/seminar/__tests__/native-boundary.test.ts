// @vitest-environment node
import { expect, it, vi } from "vitest";

vi.mock("sharp", () => { throw new Error("Worker-only sharp is unavailable in this request runtime"); });
vi.mock("@/lib/pdf-page-render", () => { throw new Error("Worker-only PDF renderer is unavailable in this request runtime"); });
vi.mock("../render", () => { throw new Error("Worker-only deck renderer is unavailable in this request runtime"); });
vi.mock("@/lib/prisma", () => ({
  prisma: { agentOperation: { findFirst: vi.fn(async () => null) } },
}));

it("reads seminar task and export status without loading native worker dependencies", async () => {
  const { getTask } = await import("@/lib/agent/service");
  const { latestSeminarExport } = await import("../exports");
  const { prisma } = await import("@/lib/prisma");
  expect(getTask).toBeTypeOf("function");
  await expect(latestSeminarExport(prisma, "task-without-an-export")).resolves.toBeNull();
});
