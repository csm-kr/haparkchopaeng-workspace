import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/papers/:id/reanalyze 팀 스코핑(ADR-020/R37) — 활성 팀의 논문만 재분석.
// 검증: 활성 팀 논문이면 pending + 이벤트 · 다른 팀 논문이면 404(교차 팀 격리) · 없으면 404.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { paper: { findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { inngestSendMock } = vi.hoisted(() => ({ inngestSendMock: vi.fn() }));
vi.mock("@/lib/inngest", () => ({ inngest: { send: inngestSendMock } }));

const { POST } = await import("@/app/api/papers/[id]/reanalyze/route");

const req = () =>
  new Request("http://localhost/api/papers/p1/reanalyze", { method: "POST" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
  inngestSendMock.mockResolvedValue(undefined);
  prismaMock.paper.update.mockResolvedValue({});
});

describe("POST /api/papers/:id/reanalyze", () => {
  it("활성 팀의 논문이면 pending으로 되돌리고 이벤트를 보낸다", async () => {
    prismaMock.paper.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; teamId: string } }) =>
        where.id === "p1" && where.teamId === "tA" ? { id: "p1" } : null,
    );

    const res = await POST(req(), ctx("p1"));
    expect(res.status).toBe(200);
    expect(prismaMock.paper.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          analysisStatus: "pending",
          analysisStartedAt: expect.any(Date),
        }),
      }),
    );
    expect(inngestSendMock).toHaveBeenCalled();
  });

  it("다른 팀의 논문이면 404 (교차 팀 격리, R37) — 재분석 안 함", async () => {
    prismaMock.paper.findFirst.mockResolvedValue(null);
    const res = await POST(req(), ctx("p1"));
    expect(res.status).toBe(404);
    expect(prismaMock.paper.update).not.toHaveBeenCalled();
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("활성 팀이 없으면 404", async () => {
    getActiveTeamMock.mockResolvedValue(null);
    const res = await POST(req(), ctx("p1"));
    expect(res.status).toBe(404);
    expect(prismaMock.paper.update).not.toHaveBeenCalled();
  });
});
