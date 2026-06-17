import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH /api/papers/:id 단위 테스트 — 논문 이름(제목) 변경. auth/active-team/prisma 모킹.
// 검증: 팀 멤버 누구나 변경 가능(작성자 제한 없음)·없음 404·교차 팀 404(R37)·빈 제목 400·공백 trim·활성 팀 없음 404.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    paper: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { PATCH } = await import("@/app/api/papers/[id]/route");

const req = (body: unknown) =>
  new Request("http://localhost/api/papers/p1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// 활성 팀 tA의 논문만 보이게 — where.teamId 일치할 때만 조회된다(교차 팀 격리, R37).
function scoped(paper: { id: string; uploadedBy: string; teamId: string }) {
  return async ({ where }: { where: { id: string; teamId: string } }) =>
    where.id === paper.id && where.teamId === paper.teamId ? paper : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
  // update는 받은 title을 그대로 돌려준다(echo) — 응답 검증용.
  prismaMock.paper.update.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: { title: string } }) => ({
      id: where.id,
      title: data.title,
    }),
  );
});

describe("PATCH /api/papers/:id", () => {
  it("팀 멤버면 작성자가 아니어도 제목을 바꾼다 — 200", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.paper.findFirst.mockImplementation(
      scoped({ id: "p1", uploadedBy: "ha", teamId: "tA" }),
    );

    const res = await PATCH(req({ title: "새 제목" }), ctx("p1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.title).toBe("새 제목");
    expect(prismaMock.paper.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { title: "새 제목" },
    });
  });

  it("제목 앞뒤 공백은 잘라서 저장한다", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.paper.findFirst.mockImplementation(
      scoped({ id: "p1", uploadedBy: "jo", teamId: "tA" }),
    );

    const res = await PATCH(req({ title: "   다듬은 제목   " }), ctx("p1"));
    expect(res.status).toBe(200);
    expect(prismaMock.paper.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { title: "다듬은 제목" },
    });
  });

  it("빈 제목(공백뿐)이면 400 — 저장 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.paper.findFirst.mockImplementation(
      scoped({ id: "p1", uploadedBy: "jo", teamId: "tA" }),
    );

    const res = await PATCH(req({ title: "   " }), ctx("p1"));
    expect(res.status).toBe(400);
    expect(prismaMock.paper.update).not.toHaveBeenCalled();
  });

  it("없는 논문은 404 — 저장 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.paper.findFirst.mockResolvedValue(null);

    const res = await PATCH(req({ title: "x" }), ctx("nope"));
    expect(res.status).toBe(404);
    expect(prismaMock.paper.update).not.toHaveBeenCalled();
  });

  it("다른 팀의 논문이면 404 (교차 팀 격리, R37) — 저장 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    // 논문은 tB 소속, 활성 팀은 tA → findFirst가 null.
    prismaMock.paper.findFirst.mockImplementation(
      scoped({ id: "p1", uploadedBy: "jo", teamId: "tB" }),
    );

    const res = await PATCH(req({ title: "x" }), ctx("p1"));
    expect(res.status).toBe(404);
    expect(prismaMock.paper.update).not.toHaveBeenCalled();
  });

  it("활성 팀이 없으면 404 (스코프 불가) — 저장 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    getActiveTeamMock.mockResolvedValue(null);

    const res = await PATCH(req({ title: "x" }), ctx("p1"));
    expect(res.status).toBe(404);
    expect(prismaMock.paper.update).not.toHaveBeenCalled();
  });
});
