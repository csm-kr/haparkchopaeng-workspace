import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/presentations/:id/pages(+/:n) 단위 테스트 — auth/active-team/prisma 경유 헬퍼·렌더 모킹.
// 검증: 활성 팀 스코프(다른 팀/자료 없음 → 404, R37/R19)·페이지 수 반환·페이지 PNG 반환·n 검증/클램프.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { pdfPathMock } = vi.hoisted(() => ({ pdfPathMock: vi.fn() }));
vi.mock("@/lib/presentations", () => ({ getTeamPresentationPdfPath: pdfPathMock }));

const { downloadMock } = vi.hoisted(() => ({ downloadMock: vi.fn() }));
vi.mock("@/lib/storage", () => ({ downloadObject: downloadMock }));

const { countMock, renderMock } = vi.hoisted(() => ({
  countMock: vi.fn(),
  renderMock: vi.fn(),
}));
vi.mock("@/lib/pdf-page-render", () => ({
  countPdfPages: countMock,
  renderPdfPageToPng: renderMock,
}));

const { GET: getCount } = await import("@/app/api/presentations/[id]/pages/route");
const { GET: getPage } = await import("@/app/api/presentations/[id]/pages/[n]/route");

const req = () => new Request("http://localhost/api/presentations/p1/pages");
const countParams = { params: Promise.resolve({ id: "p1" }) };
const pageParams = (n: string) => ({ params: Promise.resolve({ id: "p1", n }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ memberId: "ha", role: "멤버" });
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
  pdfPathMock.mockResolvedValue("presentations/p1.pdf");
  downloadMock.mockResolvedValue(Buffer.from("PDFBYTES"));
  countMock.mockReturnValue(7);
  renderMock.mockReturnValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

describe("GET /api/presentations/:id/pages (count)", () => {
  it("페이지 수를 반환한다", async () => {
    const res = await getCount(req(), countParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.count).toBe(7);
    expect(pdfPathMock).toHaveBeenCalledWith("p1", "tA");
  });

  it("활성 팀이 없으면 404 (PDF 조회 안 함)", async () => {
    getActiveTeamMock.mockResolvedValue(null);
    const res = await getCount(req(), countParams);
    expect(res.status).toBe(404);
    expect(pdfPathMock).not.toHaveBeenCalled();
  });

  it("다른 팀 자료/PDF 없음이면 404", async () => {
    pdfPathMock.mockResolvedValue(null);
    const res = await getCount(req(), countParams);
    expect(res.status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/presentations/:id/pages/:n (page PNG)", () => {
  it("페이지 PNG(image/png)를 반환하고 n을 0-based로 렌더한다", async () => {
    const res = await getPage(req(), pageParams("3"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(renderMock).toHaveBeenCalledWith(expect.any(Buffer), 2); // 1-based 3 → index 2
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
  });

  it("n이 숫자가 아니거나 1 미만이면 400 (렌더 안 함)", async () => {
    expect((await getPage(req(), pageParams("abc"))).status).toBe(400);
    expect((await getPage(req(), pageParams("0"))).status).toBe(400);
    expect(renderMock).not.toHaveBeenCalled();
  });

  it("자료가 없으면 404", async () => {
    pdfPathMock.mockResolvedValue(null);
    const res = await getPage(req(), pageParams("1"));
    expect(res.status).toBe(404);
    expect(renderMock).not.toHaveBeenCalled();
  });
});
