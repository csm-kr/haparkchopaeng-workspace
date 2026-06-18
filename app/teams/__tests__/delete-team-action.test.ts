import { beforeEach, describe, expect, it, vi } from "vitest";

// deleteTeamAction 단위 테스트 — auth/prisma/teams/cache 모킹.
// 검증: 미인증 거부 · 없는 slug 404 · 비관리자&비owner FORBIDDEN · owner ok · 전역 관리자 ok.
const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { team: { findUnique: findUniqueMock } } }));

const { isTeamOwnerMock, deleteTeamMock } = vi.hoisted(() => ({
  isTeamOwnerMock: vi.fn(),
  deleteTeamMock: vi.fn(),
}));
vi.mock("@/lib/teams", () => ({ isTeamOwner: isTeamOwnerMock, deleteTeam: deleteTeamMock }));

const { revalidatePathMock } = vi.hoisted(() => ({ revalidatePathMock: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { HttpError } from "@/lib/http";
const { deleteTeamAction } = await import("@/app/teams/actions");

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueMock.mockResolvedValue({ id: "t1", slug: "crew", name: "Crew" });
  isTeamOwnerMock.mockResolvedValue(false);
});

describe("deleteTeamAction", () => {
  it("미인증이면 삭제하지 않고 UNAUTHORIZED", async () => {
    requireAuthMock.mockRejectedValue(new HttpError(401, "UNAUTHORIZED", "x"));
    const result = await deleteTeamAction("crew");
    expect(result).toEqual({ ok: false, code: "UNAUTHORIZED", message: "로그인이 필요해요." });
    expect(deleteTeamMock).not.toHaveBeenCalled();
  });

  it("없는 slug면 NOT_FOUND", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    findUniqueMock.mockResolvedValue(null);
    const result = await deleteTeamAction("ghost");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND", message: "팀을 찾을 수 없어요." });
    expect(deleteTeamMock).not.toHaveBeenCalled();
  });

  it("비관리자&비owner면 FORBIDDEN(삭제 안 함)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    isTeamOwnerMock.mockResolvedValue(false);
    const result = await deleteTeamAction("crew");
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("FORBIDDEN");
    expect(deleteTeamMock).not.toHaveBeenCalled();
  });

  it("팀 owner(비관리자)면 삭제하고 ok", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "멤버" });
    isTeamOwnerMock.mockResolvedValue(true);
    const result = await deleteTeamAction("crew");
    expect(result).toEqual({ ok: true });
    expect(deleteTeamMock).toHaveBeenCalledWith("t1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/teams");
  });

  it("전역 관리자면 owner가 아니어도 삭제하고 ok", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "관리자" });
    isTeamOwnerMock.mockResolvedValue(false);
    const result = await deleteTeamAction("crew");
    expect(result).toEqual({ ok: true });
    expect(deleteTeamMock).toHaveBeenCalledWith("t1");
  });
});
