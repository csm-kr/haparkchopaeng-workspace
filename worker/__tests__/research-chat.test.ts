// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

interface RunInput {
  event: { data: { jobId: string } };
  step: { run: (name: string, callback: () => Promise<unknown>) => Promise<unknown> };
}
interface FailureInput { event: { data: { event: { data: { jobId: string } }; error: unknown } } }
const m = vi.hoisted(() => ({
  begin: vi.fn(), guard: vi.fn(), source: vi.fn(), finish: vi.fn(), fail: vi.fn(),
  create: vi.fn((options: { id: string; retries: number; triggers: { event: string }[]; onFailure: (input: FailureInput) => Promise<void> }, handler: (input: RunInput) => Promise<{ jobId: string }>) => ({ options, handler })),
}));
vi.mock("@/lib/inngest", () => ({ inngest: { createFunction: m.create } }));
vi.mock("@/lib/research-chat/preparation", () => ({ beginChatPreparation: m.begin, assertChatPreparation: m.guard, finishChatPreparation: m.finish, failChatPreparation: m.fail }));
vi.mock("../prepare-pdf-source", () => ({ preparePdfSource: m.source }));
await import("../research-chat");
const [options, handler] = m.create.mock.calls[0];

const plan = { jobId: "job", version: 0, teamId: "team", paperIds: ["paper"], presentationIds: ["seminar"] };
beforeEach(() => { vi.resetAllMocks(); m.begin.mockResolvedValue(plan); m.guard.mockResolvedValue(undefined); m.finish.mockResolvedValue(undefined); m.fail.mockResolvedValue(undefined); });

describe("durable research chat worker", () => {
  it("executes begin/finish in short steps and leaves the page orchestrator outside step.run", async () => {
    expect(options).toMatchObject({ id: "prepare-research-chat", retries: 3, triggers: [{ event: "research-chat/prepare" }] });
    let active = false;
    const run = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
      expect(active, "nested durable step").toBe(false);
      active = true;
      try { return await callback(); } finally { active = false; }
    });
    m.source.mockImplementation(async (target, step, guard) => {
      await step.run(`${target.kind}-page`, async () => { await guard(); });
      return { target, source: null };
    });
    expect(await handler({ event: { data: { jobId: "job" } }, step: { run } })).toEqual({ jobId: "job" });
    expect(run.mock.calls.map(call => call[0])).toEqual(["begin-material-preparation", "paper-page", "presentation-page", "finish-material-preparation"]);
    expect(m.begin).toHaveBeenCalledWith("job");
    expect(m.guard).toHaveBeenCalledTimes(2);
    expect(m.finish).toHaveBeenCalledWith(plan, [{ target: { kind: "paper", id: "paper", teamId: "team" }, source: null }, { target: { kind: "presentation", id: "seminar", teamId: "team" }, source: null }]);
  });
  it("does not read materials or queue a cancelled/expired preparation", async () => {
    m.begin.mockResolvedValue(null);
    await handler({ event: { data: { jobId: "job" } }, step: { run: async (_name, callback) => callback() } });
    expect(m.source).not.toHaveBeenCalled();
    expect(m.finish).not.toHaveBeenCalled();
  });

  it("passes terminal event failure to the scoped preparation failure handler", async () => {
    const failure = { message: "source unavailable" };
    await options.onFailure({ event: { data: { event: { data: { jobId: "job" } }, error: failure } } });
    expect(m.fail).toHaveBeenCalledTimes(1);
    expect(m.fail).toHaveBeenCalledWith("job", failure);
    expect(m.begin).not.toHaveBeenCalled();
  });
});
