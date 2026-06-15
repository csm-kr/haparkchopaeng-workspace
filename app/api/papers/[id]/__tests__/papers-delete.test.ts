import { beforeEach, describe, expect, it, vi } from "vitest";

// DELETE /api/papers/:id 단위 테스트 — auth/active-team/prisma/storage 모킹.
// 검증: 404·비소유자 403·소유자 200·교차 팀 404(R37)·cascade delete + PDF 정리 호출.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    paper: { findFirst: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { removeObjectMock, removeFolderMock } = vi.hoisted(() => ({
  removeObjectMock: vi.fn(),
  removeFolderMock: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  removeObject: removeObjectMock,
  removeFolder: removeFolderMock,
}));

const { DELETE } = await import("@/app/api/papers/[id]/route");

const req = () => new Request("http://localhost/api/papers/p1", { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// 활성 팀 tA의 논문만 보이게 — where.teamId 일치할 때만 조회된다(교차 팀 격리, R37).
function scoped(paper: { id: string; uploadedBy: string; pdfUrl: string; teamId: string }) {
  return async ({ where }: { where: { id: string; teamId: string } }) =>
    where.id === paper.id && where.teamId === paper.teamId ? paper : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  removeObjectMock.mockResolvedValue(undefined);
  removeFolderMock.mockResolvedValue(undefined);
  prismaMock.paper.delete.mockResolvedValue({});
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
});

describe("DELETE /api/papers/:id", () => {
  it("없는 논문은 404", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    prismaMock.paper.findFirst.mockResolvedValue(null);

    const res = await DELETE(req(), ctx("nope"));
    expect(res.status).toBe(404);
    expect(prismaMock.paper.delete).not.toHaveBeenCalled();
  });

  it("올린 사람도 관리자도 아니면 403 (삭제 안 함)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.paper.findFirst.mockImplementation(
      scoped({ id: "p1", uploadedBy: "ha", pdfUrl: "papers/p1.pdf", teamId: "tA" }),
    );

    const res = await DELETE(req(), ctx("p1"));
    expect(res.status).toBe(403);
    expect(prismaMock.paper.delete).not.toHaveBeenCalled();
    expect(removeObjectMock).not.toHaveBeenCalled();
  });

  it("올린 사람이면 삭제 + 원문 PDF 정리", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.paper.findFirst.mockImplementation(
      scoped({ id: "p1", uploadedBy: "jo", pdfUrl: "papers/p1.pdf", teamId: "tA" }),
    );

    const res = await DELETE(req(), ctx("p1"));
    expect(res.status).toBe(200);
    expect(prismaMock.paper.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(removeObjectMock).toHaveBeenCalledWith("papers/p1.pdf");
    expect(removeFolderMock).toHaveBeenCalledWith("figures/p1");
  });

  it("관리자라도 남의 논문은 삭제할 수 없다(작성자만) — 403", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    prismaMock.paper.findFirst.mockImplementation(
      scoped({ id: "p1", uploadedBy: "jo", pdfUrl: "papers/p1.pdf", teamId: "tA" }),
    );

    const res = await DELETE(req(), ctx("p1"));
    expect(res.status).toBe(403);
    expect(prismaMock.paper.delete).not.toHaveBeenCalled();
  });

  it("다른 팀의 논문이면 404 (교차 팀 격리, R37) — 삭제 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    // 논문은 tB 소속, 활성 팀은 tA → findFirst가 null을 돌려준다.
    prismaMock.paper.findFirst.mockImplementation(
      scoped({ id: "p1", uploadedBy: "jo", pdfUrl: "papers/p1.pdf", teamId: "tB" }),
    );

    const res = await DELETE(req(), ctx("p1"));
    expect(res.status).toBe(404);
    expect(prismaMock.paper.delete).not.toHaveBeenCalled();
  });
});
