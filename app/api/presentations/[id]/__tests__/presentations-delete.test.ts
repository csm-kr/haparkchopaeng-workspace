import { beforeEach, describe, expect, it, vi } from "vitest";

// DELETE /api/presentations/:id 단위 테스트 — auth/prisma 모킹.
// 검증: 404·비발표자 403·발표자/관리자 200·cascade delete.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    presentation: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { DELETE } = await import("@/app/api/presentations/[id]/route");

const req = () =>
  new Request("http://localhost/api/presentations/pres1", { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.presentation.delete.mockResolvedValue({});
});

describe("DELETE /api/presentations/:id", () => {
  it("없는 자료는 404", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    prismaMock.presentation.findUnique.mockResolvedValue(null);

    const res = await DELETE(req(), ctx("nope"));
    expect(res.status).toBe(404);
    expect(prismaMock.presentation.delete).not.toHaveBeenCalled();
  });

  it("발표자도 관리자도 아니면 403 (삭제 안 함)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.presentation.findUnique.mockResolvedValue({
      id: "pres1",
      presenterId: "jo",
    });

    const res = await DELETE(req(), ctx("pres1"));
    expect(res.status).toBe(403);
    expect(prismaMock.presentation.delete).not.toHaveBeenCalled();
  });

  it("발표자면 삭제(에셋·버전·댓글 cascade)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.presentation.findUnique.mockResolvedValue({
      id: "pres1",
      presenterId: "jo",
    });

    const res = await DELETE(req(), ctx("pres1"));
    expect(res.status).toBe(200);
    expect(prismaMock.presentation.delete).toHaveBeenCalledWith({
      where: { id: "pres1" },
    });
  });

  it("관리자라도 남의 자료는 삭제할 수 없다(발표자만) — 403", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    prismaMock.presentation.findUnique.mockResolvedValue({
      id: "pres1",
      presenterId: "jo",
    });

    const res = await DELETE(req(), ctx("pres1"));
    expect(res.status).toBe(403);
    expect(prismaMock.presentation.delete).not.toHaveBeenCalled();
  });
});
