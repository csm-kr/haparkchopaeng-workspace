import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/papers/:id/pdf 단위 테스트 — auth/active-team/prisma/storage 모킹.
// 검증: 활성 팀의 논문이면 302+서명 URL · 다른 팀 논문이면 404(교차 팀 격리, R37) ·
//       없는 논문 404 · 미인증 차단(R36).

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { paper: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { signedDownloadUrlMock } = vi.hoisted(() => ({
  signedDownloadUrlMock: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({ signedDownloadUrl: signedDownloadUrlMock }));

const { GET } = await import("@/app/api/papers/[id]/pdf/route");

const req = () => new Request("http://localhost/api/papers/p1/pdf");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "owner" });
});

describe("GET /api/papers/:id/pdf", () => {
  it("활성 팀의 논문이면 단기 서명 URL로 302 리디렉트한다(R36)", async () => {
    // 활성 팀 필터 — where: { id, teamId } 일치할 때만 조회된다.
    prismaMock.paper.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; teamId: string } }) =>
        where.id === "p1" && where.teamId === "tA"
          ? { pdfUrl: "papers/p1.pdf" }
          : null,
    );
    signedDownloadUrlMock.mockResolvedValue("https://store/sign/pdf?token=abc");

    const res = await GET(req(), ctx("p1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://store/sign/pdf?token=abc");
    expect(signedDownloadUrlMock).toHaveBeenCalledWith("papers/p1.pdf", 60);
  });

  it("다른 팀 논문이면 404(교차 팀 격리, R37) — 서명하지 않는다", async () => {
    prismaMock.paper.findFirst.mockResolvedValue(null);
    const res = await GET(req(), ctx("p1"));
    expect(res.status).toBe(404);
    expect(signedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("없는 논문은 404", async () => {
    prismaMock.paper.findFirst.mockResolvedValue(null);
    const res = await GET(req(), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("미인증이면 서명하지 않는다(requireAuth가 던짐)", async () => {
    requireAuthMock.mockRejectedValue(new Error("UNAUTHORIZED"));
    const res = await GET(req(), ctx("p1"));
    expect(res.status).not.toBe(302);
    expect(signedDownloadUrlMock).not.toHaveBeenCalled();
  });
});
