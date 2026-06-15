import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH/DELETE /api/teams/:slug/members/:memberId 단위 테스트 — auth/prisma 모킹.
// 멀티팀(ADR-018/R19): 권한은 앱레벨에서 멤버십 역할로 강제. owner는 강등·추방 불가(팀당 owner ≥ 1).
// PATCH: owner만, 대상 owner 불가, admin|member만. DELETE: 본인 탈퇴(비-owner)/owner가 비-owner 제거/
//        admin이 member 제거, owner(마지막 포함) 제거 차단.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    team: { findUnique: vi.fn() },
    membership: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { PATCH, DELETE } = await import("@/app/api/teams/[slug]/members/[memberId]/route");

const ctx = (slug: string, memberId: string) => ({
  params: Promise.resolve({ slug, memberId }),
});
const patchReq = (body: unknown) =>
  new Request("http://localhost/api/teams/crew/members/x", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
const delReq = () =>
  new Request("http://localhost/api/teams/crew/members/x", { method: "DELETE" });

// 팀 멤버십을 인메모리로 구성한다(teamId="t1", slug="crew").
const memberships: Record<string, string> = {}; // memberId -> role
function setMembers(map: Record<string, string>) {
  for (const k of Object.keys(memberships)) delete memberships[k];
  Object.assign(memberships, map);
}

beforeEach(() => {
  vi.clearAllMocks();
  setMembers({});
  prismaMock.team.findUnique.mockImplementation(async ({ where }: { where: { slug: string } }) =>
    where.slug === "crew" ? { id: "t1", slug: "crew", name: "Crew" } : null,
  );
  prismaMock.membership.findUnique.mockImplementation(
    async ({ where }: { where: { teamId_memberId: { teamId: string; memberId: string } } }) => {
      const { teamId, memberId } = where.teamId_memberId;
      const role = memberships[memberId];
      return teamId === "t1" && role ? { teamId, memberId, role } : null;
    },
  );
  prismaMock.membership.update.mockImplementation(
    async ({ where, data }: { where: { teamId_memberId: { memberId: string } }; data: { role: string } }) => ({
      teamId: "t1",
      memberId: where.teamId_memberId.memberId,
      role: data.role,
    }),
  );
  prismaMock.membership.delete.mockResolvedValue({});
});

describe("PATCH /api/teams/:slug/members/:memberId", () => {
  it("팀이 없으면 404", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    const res = await PATCH(patchReq({ role: "admin" }), ctx("nope", "bak"));
    expect(res.status).toBe(404);
  });

  it("owner가 아니면 403", async () => {
    setMembers({ ha: "admin", bak: "member" });
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "멤버" });
    const res = await PATCH(patchReq({ role: "admin" }), ctx("crew", "bak"));
    expect(res.status).toBe(403);
    expect(prismaMock.membership.update).not.toHaveBeenCalled();
  });

  it("role이 owner면 400 (초대/부여 불가)", async () => {
    setMembers({ ha: "owner", bak: "member" });
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    const res = await PATCH(patchReq({ role: "owner" }), ctx("crew", "bak"));
    expect(res.status).toBe(400);
    expect(prismaMock.membership.update).not.toHaveBeenCalled();
  });

  it("대상이 owner면 403 (강등 불가)", async () => {
    setMembers({ ha: "owner", jo: "owner" });
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    const res = await PATCH(patchReq({ role: "member" }), ctx("crew", "jo"));
    expect(res.status).toBe(403);
    expect(prismaMock.membership.update).not.toHaveBeenCalled();
  });

  it("owner가 member→admin 승격하면 200", async () => {
    setMembers({ ha: "owner", bak: "member" });
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    const res = await PATCH(patchReq({ role: "admin" }), ctx("crew", "bak"));
    expect(res.status).toBe(200);
    const arg = prismaMock.membership.update.mock.calls[0][0];
    expect(arg.where.teamId_memberId).toEqual({ teamId: "t1", memberId: "bak" });
    expect(arg.data.role).toBe("admin");
  });
});

describe("DELETE /api/teams/:slug/members/:memberId", () => {
  it("owner는 내보낼 수 없다 (팀당 owner ≥ 1)", async () => {
    setMembers({ ha: "owner", jo: "owner" });
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    const res = await DELETE(delReq(), ctx("crew", "jo"));
    expect(res.status).toBe(403);
    expect(prismaMock.membership.delete).not.toHaveBeenCalled();
  });

  it("본인(비-owner) 탈퇴는 허용", async () => {
    setMembers({ ha: "owner", bak: "member" });
    requireAuthMock.mockResolvedValue({ memberId: "bak", role: "멤버" });
    const res = await DELETE(delReq(), ctx("crew", "bak"));
    expect(res.status).toBe(200);
    expect(prismaMock.membership.delete).toHaveBeenCalled();
  });

  it("owner가 비-owner를 내보낼 수 있다", async () => {
    setMembers({ ha: "owner", bak: "admin" });
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    const res = await DELETE(delReq(), ctx("crew", "bak"));
    expect(res.status).toBe(200);
    expect(prismaMock.membership.delete).toHaveBeenCalled();
  });

  it("admin은 member를 내보낼 수 있다", async () => {
    setMembers({ ha: "owner", bak: "admin", jo: "member" });
    requireAuthMock.mockResolvedValue({ memberId: "bak", role: "멤버" });
    const res = await DELETE(delReq(), ctx("crew", "jo"));
    expect(res.status).toBe(200);
    expect(prismaMock.membership.delete).toHaveBeenCalled();
  });

  it("admin이 다른 admin을 내보내려 하면 403", async () => {
    setMembers({ ha: "owner", bak: "admin", paeng: "admin" });
    requireAuthMock.mockResolvedValue({ memberId: "bak", role: "멤버" });
    const res = await DELETE(delReq(), ctx("crew", "paeng"));
    expect(res.status).toBe(403);
    expect(prismaMock.membership.delete).not.toHaveBeenCalled();
  });

  it("대상 멤버십이 없으면 404", async () => {
    setMembers({ ha: "owner" });
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    const res = await DELETE(delReq(), ctx("crew", "ghost"));
    expect(res.status).toBe(404);
  });
});
