import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/figures/:id/image 단위 테스트 — auth/prisma/storage 모킹.
// 검증: 경로 있으면 302+서명 URL · imageUrl null 404 · 없는 figure 404 · 미인증 차단(R36).

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { figure: { findUnique: vi.fn() } },
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
});

describe("GET /api/figures/:id/image", () => {
  it("imageUrl(경로)이 있으면 단기 서명 URL로 302 리디렉트한다(R36)", async () => {
    prismaMock.figure.findUnique.mockResolvedValue({ imageUrl: "figures/p1/0.png" });
    signedDownloadUrlMock.mockResolvedValue("https://store/sign/fig?token=abc");

    const res = await GET(req(), ctx("f1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://store/sign/fig?token=abc");
    expect(signedDownloadUrlMock).toHaveBeenCalledWith("figures/p1/0.png", 60);
  });

  it("imageUrl이 null이면 404(아직 렌더 전) — 서명하지 않는다", async () => {
    prismaMock.figure.findUnique.mockResolvedValue({ imageUrl: null });
    const res = await GET(req(), ctx("f1"));
    expect(res.status).toBe(404);
    expect(signedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it("없는 figure는 404", async () => {
    prismaMock.figure.findUnique.mockResolvedValue(null);
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
