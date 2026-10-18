// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
  const db = {
    membership: { findUnique: vi.fn() },
    researchConversation: { updateMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    localAgentJob: { updateMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
  };
  return { db, enqueue: vi.fn(), prisma: { ...db, $transaction: vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db)) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: m.prisma }));
vi.mock("@/lib/local-agent/service", () => ({ createPreparedJob: m.enqueue, cancelJob: vi.fn() }));
vi.mock("@/lib/inngest", () => ({ inngest: { send: vi.fn() } }));
import { createTurn } from "../service";

const scope = { teamId: "team", memberId: "member", sessionKey: "session", sessionExpiresAt: new Date(Date.now() + 3_600_000) };
const input = { requestId: "65f34198-e99a-418e-9803-26e76368ef17", deviceId: "pc", provider: "codex" as const, model: "actual", prompt: "자료 없이 대화해줘" };
beforeEach(() => {
  vi.clearAllMocks();
  m.db.membership.findUnique.mockResolvedValue({ memberId: scope.memberId });
  m.db.researchConversation.updateMany.mockResolvedValue({ count: 1 });
  m.db.researchConversation.findFirst.mockResolvedValue({ id: "conversation", paperIds: [] });
  m.db.localAgentJob.findUnique.mockResolvedValue(null);
  m.db.localAgentJob.count.mockResolvedValue(0);
  m.db.localAgentJob.findMany.mockResolvedValue([]);
  m.db.localAgentJob.findFirst.mockResolvedValue(null);
  m.enqueue.mockImplementation(async (_scope, target, context, options) => {
    const now = new Date();
    const job = { ...target, ...options, id: "job", version: 0, context, status: "queued", response: "", error: null,
      conversationId: "conversation", conversationTurn: 1, createdAt: now, updatedAt: now, sessionKey: scope.sessionKey };
    m.db.localAgentJob.findUniqueOrThrow.mockResolvedValue(job);
    return job;
  });
});

describe("legacy connector effort compatibility", () => {
  it("does not manufacture an effort selection when the caller omitted it", async () => {
    const turn = await createTurn(scope, "conversation", input);
    expect(turn.effort).toBeUndefined();
    const [, , context, options] = m.enqueue.mock.calls[0];
    expect(JSON.parse(context)).not.toHaveProperty("execution");
    expect(options).not.toHaveProperty("effort");
  });

  it("preserves an explicitly selected effort in both context and admission", async () => {
    const turn = await createTurn(scope, "conversation", { ...input, effort: "high" });
    expect(turn.effort).toBe("high");
    const [, , context, options] = m.enqueue.mock.calls[0];
    expect(JSON.parse(context).execution).toEqual({ effort: "high" });
    expect(options.effort).toBe("high");
  });
});
