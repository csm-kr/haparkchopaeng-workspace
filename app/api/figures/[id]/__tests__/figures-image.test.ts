import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/figures/:id/image 단위 테스트 — auth/active-team/prisma/storage 모킹.
// 검증: 활성 팀의 figure면 302+서명 URL · 다른 팀 figure면 404(교차 팀 격리, R37) ·
//       imageUrl null 404 · 없는 figure 404 · 미인증 차단(R36).

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { figure: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { signedDownloadUrlMock } = vi.hoisted(() => ({
  signedDownloadUrlMock: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({ signedDownloadUrl: signedDownloadUrlMock }));

const { GET } = await import("@/app/api/figures/[id]/image/route");

const req = () => new Request("http://localhost/api/figures/f1/image");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "owner" });
});

describe("GET /api/figures/:id/image", () => {
  it("활성 팀의 figure면 단기 서명 URL로 302 리디렉트한다(R36)", async () => {
    // 부모 Paper.teamId가 활성 팀일 때만 조회된다 — where: { id, paper: { teamId } }.
    prismaMock.figure.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; paper: { teamId: string } } }) =>
        where.id === "f1" && where.paper.teamId === "tA"
          ? { imageUrl: "figures/p1/0.png" }
          : null,
    );
    signedDownloadUrlMock.mockResolvedValue("https://store/sign/fig?token=abc");

    const res = await GET(req(), ctx("f1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://store/sign/fig?token=abc");
    expect(signedDownloadUrlMock).toHaveBeenCalledWith("figures/p1/0.png", 60);
  });

  it("다른 팀 figure면 404(교차 팀 격리, R37) — 서명하지 않는다", async () => {
    // 활성 팀 필터로 findFirst가 null을 돌려준다(다른 팀 소유).
    prismaMock.figure.findFirst.mockResolvedValue(null);
    const res = await GET(req(), ctx("f1"));
    expect(res.status).toBe(404);
    expect(signedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("imageUrl이 null이면 404(아직 렌더 전) — 서명하지 않는다", async () => {
    prismaMock.figure.findFirst.mockResolvedValue({ imageUrl: null });
    const res = await GET(req(), ctx("f1"));
    expect(res.status).toBe(404);
    expect(signedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("없는 figure는 404", async () => {
    prismaMock.figure.findFirst.mockResolvedValue(null);
    const res = await GET(req(), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("미인증이면 서명하지 않는다(requireAuth가 던짐)", async () => {
    requireAuthMock.mockRejectedValue(new Error("UNAUTHORIZED"));
    const res = await GET(req(), ctx("f1"));
    expect(res.status).not.toBe(302);
    expect(signedDownloadUrlMock).not.toHaveBeenCalled();
  });
});
