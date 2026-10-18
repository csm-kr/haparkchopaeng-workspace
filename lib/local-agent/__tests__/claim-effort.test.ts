// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
  const db = {
    membership: { findUnique: vi.fn() },
    localAgentDevice: { findUnique: vi.fn(), update: vi.fn() },
    localAgentGrant: { findFirst: vi.fn() },
    localAgentSnapshot: { findUnique: vi.fn() },
    localAgentJob: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  };
  return { db, prisma: { ...db, $transaction: vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db)) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: m.prisma }));
import { claimJob, getJob } from "../service";
import { hashCredential } from "../security";

const token = Buffer.alloc(32, 19).toString("base64url");
const identity = { deviceId: "device", deviceToken: token };
const scope = { teamId: "team", memberId: "member", sessionKey: "session", sessionExpiresAt: new Date(Date.now() + 600_000) };
const chatContext = (execution?: unknown) => JSON.stringify({ version: 1, kind: "research_chat", papers: [], history: [], ...(execution === undefined ? {} : { execution }) });

function currentModel(reasoningEfforts?: string[]) {
  const now = new Date();
  m.db.localAgentSnapshot.findUnique.mockResolvedValue({ observedAt: now, payload: {
    provider: "codex", status: "ready", models: [{ id: "actual-model", name: "Actual", ...(reasoningEfforts ? { reasoningEfforts } : {}) }],
    quota: null, observedAt: now.toISOString(),
  } });
}

function queuedContext(context: string) {
  const now = new Date(), grant = { revokedAt: null, leaseExpiresAt: new Date(now.getTime() + 45_000) };
  let stored = { id: "job", deviceId: "device", teamId: "team", memberId: "member", sessionKey: "session", paperId: "",
    purpose: "chat", conversationId: "conversation", conversationTurn: 1, provider: "codex", model: "actual-model", prompt: "Hello",
    context, status: "queued", response: "", error: null, version: 0, createdAt: now, updatedAt: now, grant };
  m.db.localAgentJob.findFirst.mockImplementation(async ({ where }) => (!where.status || where.status === stored.status) ? stored : null);
  m.db.localAgentJob.findUnique.mockImplementation(async () => stored);
  m.db.localAgentJob.updateMany.mockImplementation(async ({ where, data }) => {
    // Fresh grant/job fixtures are not expired. Apply only the versioned job CAS.
    if (where.id !== stored.id || where.status !== stored.status || where.version !== stored.version) return { count: 0 };
    stored = { ...stored, ...data, version: stored.version + (data.version?.increment ?? 0) };
    return { count: 1 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "claim-effort-isolated-fixture-only";
  m.db.membership.findUnique.mockResolvedValue({ memberId: "member" });
  m.db.localAgentDevice.findUnique.mockResolvedValue({ id: "device", memberId: "member", teamId: "team", revokedAt: null, secretHash: hashCredential(token) });
  m.db.localAgentDevice.update.mockResolvedValue({});
  m.db.localAgentGrant.findFirst.mockResolvedValue({ revokedAt: null, leaseExpiresAt: new Date(Date.now() + 45_000) });
  m.db.localAgentJob.count.mockResolvedValue(0);
  currentModel(["low", "high"]);
  queuedContext(chatContext({ effort: "high" }));
});

describe("effort capability at the desktop claim boundary", () => {
  it.each([undefined, ["low"]])("cancels a queued explicit effort when the latest model metadata no longer supports it (%j)", async (levels) => {
    currentModel(levels);
    expect(await claimJob(identity)).toBeNull();
    expect(await getJob(scope, "job")).toMatchObject({ status: "cancelled", response: "", error: expect.stringMatching(/effort/) });
  });
  it("keeps an explicit supported effort and legacy no-effort free chat claimable", async () => {
    expect((await claimJob(identity))?.context).toBe(chatContext({ effort: "high" }));
    currentModel(); queuedContext(chatContext());
    expect((await claimJob(identity))?.context).toBe(chatContext());
  });
  it.each(["not JSON", chatContext({ effort: "high; run-shell" }), chatContext({ effort: "high", command: "PRIVATE_COMMAND" })])("cancels malformed execution data without silently using a default", async (context) => {
    queuedContext(context);
    expect(await claimJob(identity)).toBeNull();
    const job = await getJob(scope, "job");
    expect(job.status).toBe("cancelled");
    expect(job.error).toMatch(/effort/);
    expect(job.error).not.toMatch(/PRIVATE_COMMAND|run-shell|not JSON/);
  });
});
