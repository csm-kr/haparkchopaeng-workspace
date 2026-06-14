import { beforeEach, describe, expect, it, vi } from "vitest";

// DELETE /api/papers/:id 단위 테스트 — auth/prisma/storage 모킹.
// 검증: 404·비소유자 403·소유자/관리자 200·cascade delete + PDF 정리 호출.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    paper: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { removeObjectMock } = vi.hoisted(() => ({ removeObjectMock: vi.fn() }));
vi.mock("@/lib/storage", () => ({ removeObject: removeObjectMock }));

const { DELETE } = await import("@/app/api/papers/[id]/route");

const req = () => new Request("http://localhost/api/papers/p1", { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  removeObjectMock.mockResolvedValue(undefined);
  prismaMock.paper.delete.mockResolvedValue({});
});

describe("DELETE /api/papers/:id", () => {
  it("없는 논문은 404", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    prismaMock.paper.findUnique.mockResolvedValue(null);

    const res = await DELETE(req(), ctx("nope"));
    expect(res.status).toBe(404);
    expect(prismaMock.paper.delete).not.toHaveBeenCalled();
  });

  it("올린 사람도 관리자도 아니면 403 (삭제 안 함)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.paper.findUnique.mockResolvedValue({
      id: "p1",
      uploadedBy: "ha",
      pdfUrl: "papers/p1.pdf",
    });

    const res = await DELETE(req(), ctx("p1"));
    expect(res.status).toBe(403);
    expect(prismaMock.paper.delete).not.toHaveBeenCalled();
    expect(removeObjectMock).not.toHaveBeenCalled();
  });

  it("올린 사람이면 삭제 + 원문 PDF 정리", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.paper.findUnique.mockResolvedValue({
      id: "p1",
      uploadedBy: "jo",
      pdfUrl: "papers/p1.pdf",
    });

    const res = await DELETE(req(), ctx("p1"));
    expect(res.status).toBe(200);
    expect(prismaMock.paper.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(removeObjectMock).toHaveBeenCalledWith("papers/p1.pdf");
  });

  it("관리자라도 남의 논문은 삭제할 수 없다(작성자만) — 403", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    prismaMock.paper.findUnique.mockResolvedValue({
      id: "p1",
      uploadedBy: "jo",
      pdfUrl: "papers/p1.pdf",
    });

    const res = await DELETE(req(), ctx("p1"));
    expect(res.status).toBe(403);
    expect(prismaMock.paper.delete).not.toHaveBeenCalled();
  });
});
