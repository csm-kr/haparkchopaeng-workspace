import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createLiveSession } from "@/lib/live";
import { assertTestDatabase } from "@/scripts/test-database";

assertTestDatabase();
const mocks = vi.hoisted(() => ({ team: "", broadcast: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: async () => ({ memberId: "jo" }) }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: async () => ({ id: mocks.team, role: "owner" }) }));
vi.mock("@/lib/realtime", () => ({ broadcastLive: mocks.broadcast }));
vi.mock("@/lib/livekit", () => ({ deleteRoom: mocks.cleanup }));
const { POST: end } = await import("@/app/api/live/[id]/end/route");
const teams: string[] = [];

beforeAll(async () => {
  for (const slug of ["concurrency-a", "concurrency-b"]) {
    const team = await prisma.team.create({ data: { slug, name: slug, createdBy: "jo" } });
    teams.push(team.id);
  }
});
afterAll(async () => {
  await prisma.liveSession.deleteMany({ where: { teamId: { in: teams } } });
  await prisma.team.deleteMany({ where: { id: { in: teams } } });
  await prisma.$disconnect();
});

describe("실제 PostgreSQL 라이브 동시성", () => {
  it("같은 팀의 동시 시작 8개 중 하나만 생성하고 나머지는 409다", async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => createLiveSession(teams[0], "jo")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results) if (result.status === "rejected") expect(result.reason.status).toBe(409);
    expect(await prisma.liveSession.count({ where: { teamId: teams[0], active: true } })).toBe(1);
  });

  it("서로 다른 팀은 각각 하나의 라이브를 유지한다", async () => {
    await createLiveSession(teams[1], "jo");
    expect(await prisma.liveSession.count({ where: { teamId: { in: teams }, active: true } })).toBe(2);
  });

  it("종료 처리 중 즉시 재시작해도 중복 종료는 새 세션과 다른 팀에 영향을 주지 않는다", async () => {
    mocks.team = teams[0];
    let finish!: () => void;
    mocks.cleanup.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = await prisma.liveSession.findFirstOrThrow({ where: { teamId: teams[0], active: true } });
    const ending = end(new Request("http://localhost/api/live/end", { method: "POST" }), { params: Promise.resolve({ id: first.id }) });
    let second: Awaited<ReturnType<typeof createLiveSession>>;
    try {
      await vi.waitFor(() => expect(mocks.cleanup).toHaveBeenCalledWith(first.id));
      second = await createLiveSession(teams[0], "jo");
      const duplicate = await end(new Request("http://localhost/api/live/end", { method: "POST" }), { params: Promise.resolve({ id: first.id }) });
      expect(duplicate.status).toBe(200);
      expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    } finally { finish?.(); await ending; }
    expect(await prisma.liveSession.count({ where: { id: second!.id, active: true } })).toBe(1);
    expect(await prisma.liveSession.count({ where: { teamId: teams[1], active: true } })).toBe(1);
  });
});
