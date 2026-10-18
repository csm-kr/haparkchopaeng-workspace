// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  target: vi.fn(), advance: vi.fn(), failure: vi.fn(), prepare: vi.fn(), update: vi.fn(),
}));
vi.mock("@/lib/inngest", () => ({ inngest: { createFunction: (config: unknown, handler: unknown) => ({ config, handler }) } }));
vi.mock("@/lib/prisma", () => ({ prisma: { agentTask: { updateMany: mocks.update } } }));
vi.mock("@/lib/agent/service", () => ({ advanceTask: mocks.advance, agentSourceTarget: mocks.target, failAgentSource: mocks.failure }));
vi.mock("@/worker/prepare-pdf-source", () => ({ preparePdfSource: mocks.prepare }));
import { runAgentTaskFn } from "../agent-task";

const event = { data: { taskId: "pt-task", revision: 2 } };
const step = { run: vi.fn(async (_id: string, action: () => unknown) => action()), sleep: vi.fn() };
type Handler = (input: { event: typeof event; step: typeof step }) => Promise<unknown>;
const handler = (runAgentTaskFn as unknown as { handler: Handler }).handler;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.target.mockResolvedValue({ kind: "paper", id: "paper", teamId: "team" });
  mocks.advance.mockResolvedValue({ id: "pt-task", revision: 2, status: "waiting_input" });
  mocks.prepare.mockResolvedValue({});
});

it("prepares paper OCR through the existing durable orchestrator before inference", async () => {
  await handler({ event, step });
  expect(mocks.prepare).toHaveBeenCalledWith({ kind: "paper", id: "paper", teamId: "team" }, step, expect.any(Function));
  expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.advance.mock.invocationCallOrder[0]);
  const guard = mocks.prepare.mock.calls[0][2];
  await guard();
  expect(mocks.target).toHaveBeenLastCalledWith("pt-task", 2);
});

it("records a source failure without enqueueing model inference", async () => {
  const error = new Error("source preparation failed");
  mocks.prepare.mockRejectedValueOnce(error);
  await handler({ event, step });
  expect(mocks.failure).toHaveBeenCalledWith("pt-task", 2, error);
  expect(mocks.advance).not.toHaveBeenCalled();
});
