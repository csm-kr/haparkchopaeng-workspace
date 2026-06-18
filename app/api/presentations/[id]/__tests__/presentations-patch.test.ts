import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH /api/presentations/:id 단위 테스트 — 발표 자료 이름(제목) 변경. auth/active-team/prisma 모킹.
// 검증: 팀 멤버 누구나 변경 가능(발표자 제한 없음)·없음 404·교차 팀 404(R37)·빈 제목 400·공백 trim·활성 팀 없음 404.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    presentation: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { PATCH } = await import("@/app/api/presentations/[id]/route");

const req = (body: unknown) =>
  new Request("http://localhost/api/presentations/pres1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// 활성 팀 tA의 자료만 보이게 — where.teamId 일치할 때만 조회된다(교차 팀 격리, R37).
function scoped(pres: { id: string; presenterId: string; teamId: string }) {
  return async ({ where }: { where: { id: string; teamId: string } }) =>
    where.id === pres.id && where.teamId === pres.teamId ? pres : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
  // update는 받은 title을 그대로 돌려준다(echo) — 응답 검증용.
  prismaMock.presentation.update.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: { title: string } }) => ({
      id: where.id,
      title: data.title,
    }),
  );
});

describe("PATCH /api/presentations/:id", () => {
  it("팀 멤버면 발표자가 아니어도 제목을 바꾼다 — 200", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.presentation.findFirst.mockImplementation(
      scoped({ id: "pres1", presenterId: "jo", teamId: "tA" }),
    );

    const res = await PATCH(req({ title: "새 제목" }), ctx("pres1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.title).toBe("새 제목");
    expect(prismaMock.presentation.update).toHaveBeenCalledWith({
      where: { id: "pres1" },
      data: { title: "새 제목" },
    });
  });

  it("제목 앞뒤 공백은 잘라서 저장한다", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.presentation.findFirst.mockImplementation(
      scoped({ id: "pres1", presenterId: "jo", teamId: "tA" }),
    );

    const res = await PATCH(req({ title: "   다듬은 제목   " }), ctx("pres1"));
    expect(res.status).toBe(200);
    expect(prismaMock.presentation.update).toHaveBeenCalledWith({
      where: { id: "pres1" },
      data: { title: "다듬은 제목" },
    });
  });

  it("빈 제목(공백뿐)이면 400 — 저장 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.presentation.findFirst.mockImplementation(
      scoped({ id: "pres1", presenterId: "jo", teamId: "tA" }),
    );

    const res = await PATCH(req({ title: "   " }), ctx("pres1"));
    expect(res.status).toBe(400);
    expect(prismaMock.presentation.update).not.toHaveBeenCalled();
  });

  it("없는 자료는 404 — 저장 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.presentation.findFirst.mockResolvedValue(null);

    const res = await PATCH(req({ title: "x" }), ctx("nope"));
    expect(res.status).toBe(404);
    expect(prismaMock.presentation.update).not.toHaveBeenCalled();
  });

  it("다른 팀의 자료면 404 (교차 팀 격리, R37) — 저장 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    // 자료는 tB 소속, 활성 팀은 tA → findFirst가 null.
    prismaMock.presentation.findFirst.mockImplementation(
      scoped({ id: "pres1", presenterId: "jo", teamId: "tB" }),
    );

    const res = await PATCH(req({ title: "x" }), ctx("pres1"));
    expect(res.status).toBe(404);
    expect(prismaMock.presentation.update).not.toHaveBeenCalled();
  });

  it("활성 팀이 없으면 404 (스코프 불가) — 저장 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    getActiveTeamMock.mockResolvedValue(null);

    const res = await PATCH(req({ title: "x" }), ctx("pres1"));
    expect(res.status).toBe(404);
    expect(prismaMock.presentation.update).not.toHaveBeenCalled();
  });
});
