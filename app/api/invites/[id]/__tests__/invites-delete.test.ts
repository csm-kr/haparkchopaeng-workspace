import { beforeEach, describe, expect, it, vi } from "vitest";

// DELETE /api/invites/:id — 초대 회수는 owner만(R19). auth/teams/prisma 모킹.
// admin이어도 owner가 아니면 403, owner면 revokedAt 설정 후 200.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { isTeamOwnerMock, isTeamAdminMock } = vi.hoisted(() => ({
  isTeamOwnerMock: vi.fn(),
  isTeamAdminMock: vi.fn(),
}));
vi.mock("@/lib/teams", () => ({
  isTeamOwner: isTeamOwnerMock,
  isTeamAdmin: isTeamAdminMock,
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { invite: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { DELETE } = await import("@/app/api/invites/[id]/route");

const req = () => new Request("http://localhost/api/invites/i1", { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.invite.update.mockResolvedValue({ id: "i1", revokedAt: new Date() });
});

describe("DELETE /api/invites/:id (회수는 owner만)", () => {
  it("없는 초대는 404", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "멤버" });
    prismaMock.invite.findUnique.mockResolvedValue(null);

    const res = await DELETE(req(), ctx("nope"));
    expect(res.status).toBe(404);
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it("admin이어도 owner가 아니면 회수할 수 없다 — 403 (회수 안 함)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "bak", role: "멤버" });
    prismaMock.invite.findUnique.mockResolvedValue({ id: "i1", teamId: "t1" });
    isTeamOwnerMock.mockResolvedValue(false);
    isTeamAdminMock.mockResolvedValue(true); // admin이지만 owner는 아님

    const res = await DELETE(req(), ctx("i1"));
    expect(res.status).toBe(403);
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it("owner면 초대를 회수한다(revokedAt 설정) — 200", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "멤버" });
    prismaMock.invite.findUnique.mockResolvedValue({ id: "i1", teamId: "t1" });
    isTeamOwnerMock.mockResolvedValue(true);

    const res = await DELETE(req(), ctx("i1"));
    expect(res.status).toBe(200);
    expect(prismaMock.invite.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
