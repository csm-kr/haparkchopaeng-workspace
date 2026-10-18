// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

interface RunInput {
  event: { data: { jobId: string } };
  step: { run: (name: string, callback: () => Promise<void>) => Promise<void> };
}
interface FailureInput { event: { data: { event: { data: { jobId: string } }; error: unknown } } }
const m = vi.hoisted(() => ({
  prepare: vi.fn(), fail: vi.fn(),
  create: vi.fn((options: { id: string; retries: number; triggers: { event: string }[]; onFailure: (input: FailureInput) => Promise<void> }, handler: (input: RunInput) => Promise<{ jobId: string }>) => ({ options, handler })),
}));
vi.mock("@/lib/inngest", () => ({ inngest: { createFunction: m.create } }));
vi.mock("@/lib/research-chat/preparation", () => ({ prepareChatTurn: m.prepare, failChatPreparation: m.fail }));
await import("../research-chat");

beforeEach(() => { m.prepare.mockReset().mockResolvedValue(undefined); m.fail.mockReset().mockResolvedValue(undefined); });

describe("durable research chat worker", () => {
  it("registers the preparation event and executes material reads inside a durable step", async () => {
    const [options, handler] = m.create.mock.calls[0];
    expect(options).toMatchObject({ id: "prepare-research-chat", retries: 3, triggers: [{ event: "research-chat/prepare" }] });
    const run = vi.fn(async (_name: string, callback: () => Promise<void>) => {
      expect(m.prepare).not.toHaveBeenCalled();
      await callback();
    });
    expect(await handler({ event: { data: { jobId: "job" } }, step: { run } })).toEqual({ jobId: "job" });
    expect(run).toHaveBeenCalledWith("prepare-material-context", expect.any(Function));
    expect(m.prepare).toHaveBeenCalledTimes(1);
    expect(m.prepare).toHaveBeenCalledWith("job");
  });

  it("passes terminal event failure to the scoped preparation failure handler", async () => {
    const [options] = m.create.mock.calls[0];
    const failure = { message: "source unavailable" };
    await options.onFailure({ event: { data: { event: { data: { jobId: "job" } }, error: failure } } });
    expect(m.fail).toHaveBeenCalledTimes(1);
    expect(m.fail).toHaveBeenCalledWith("job", failure);
    expect(m.prepare).not.toHaveBeenCalled();
  });
});
