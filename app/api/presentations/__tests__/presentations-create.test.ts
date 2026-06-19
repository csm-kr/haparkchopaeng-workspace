import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/presentations 단위 테스트 — auth/active-team/prisma 모킹.
// 검증: 제목 필수·발표자 세션 주입(클라 presenterId 무시)·teamId 활성 팀 주입(R3/R37)·
//       활성 팀 없으면 403·첨부 자료 생성·타입 유도·객체 키 위조 방지.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { presentation: { create: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { downloadObjectMock } = vi.hoisted(() => ({
  downloadObjectMock: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({ downloadObject: downloadObjectMock }));

const { countPdfPagesMock } = vi.hoisted(() => ({
  countPdfPagesMock: vi.fn(),
}));
vi.mock("@/lib/pdf-page-render", () => ({ countPdfPages: countPdfPagesMock }));

const { POST } = await import("@/app/api/presentations/route");

const req = (body: unknown) =>
  new Request("http://localhost/api/presentations", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.presentation.create.mockResolvedValue({ id: "pres-new" });
  requireAuthMock.mockResolvedValue({ memberId: "ha", role: "멤버" });
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
  downloadObjectMock.mockResolvedValue(Buffer.from("%PDF-fake"));
  countPdfPagesMock.mockReturnValue(0);
});

describe("POST /api/presentations", () => {
  it("제목이 비면 400 (생성 안 함)", async () => {
    const res = await POST(req({ title: "  " }));
    expect(res.status).toBe(400);
    expect(prismaMock.presentation.create).not.toHaveBeenCalled();
  });

  it("활성 팀이 없으면 403 (생성 안 함)", async () => {
    getActiveTeamMock.mockResolvedValue(null);
    const res = await POST(req({ title: "MoD 리뷰" }));
    expect(res.status).toBe(403);
    expect(prismaMock.presentation.create).not.toHaveBeenCalled();
  });

  it("발표자·teamId는 세션/활성 팀에서 취하고 생성한다(클라 입력 무시)", async () => {
    const res = await POST(
      req({ title: "MoD 리뷰", presenterId: "해커", teamId: "해커팀" }),
    );
    expect(res.status).toBe(201);
    const arg = prismaMock.presentation.create.mock.calls[0][0];
    expect(arg.data.presenterId).toBe("ha");
    expect(arg.data.teamId).toBe("tA"); // 클라가 보낸 teamId 무시(R3)
    expect(arg.data.title).toBe("MoD 리뷰");
    expect(arg.data.assets).toBeUndefined();
  });

  it("파일을 주면 첨부 자료를 함께 만들고 확장자로 타입을 정한다", async () => {
    const res = await POST(
      req({
        title: "Q2 로드맵",
        asset: {
          objectPath: "presentations/abc.pptx",
          filename: "Q2.pptx",
          size: "6.4MB",
        },
      }),
    );
    expect(res.status).toBe(201);
    const arg = prismaMock.presentation.create.mock.calls[0][0];
    expect(arg.data.assets.create).toMatchObject({
      name: "Q2.pptx",
      type: "ppt",
      size: "6.4MB",
      url: "presentations/abc.pptx",
    });
    // PPTX는 서버에서 페이지를 셀 수 없어 slideCount 0 + PDF 다운로드 안 함.
    expect(arg.data.slideCount).toBe(0);
    expect(downloadObjectMock).not.toHaveBeenCalled();
  });

  it("PDF를 주면 페이지 수를 세어 slideCount로 저장한다", async () => {
    countPdfPagesMock.mockReturnValue(12);
    const res = await POST(
      req({
        title: "MoD 리뷰",
        asset: {
          objectPath: "presentations/mod.pdf",
          filename: "MoD.pdf",
          size: "3.2MB",
        },
      }),
    );
    expect(res.status).toBe(201);
    expect(downloadObjectMock).toHaveBeenCalledWith("presentations/mod.pdf");
    const arg = prismaMock.presentation.create.mock.calls[0][0];
    expect(arg.data.slideCount).toBe(12);
  });

  it("PDF 카운트가 실패해도 생성을 막지 않고 slideCount 0", async () => {
    downloadObjectMock.mockRejectedValue(new Error("storage down"));
    const res = await POST(
      req({
        title: "MoD 리뷰",
        asset: {
          objectPath: "presentations/mod.pdf",
          filename: "MoD.pdf",
          size: "3.2MB",
        },
      }),
    );
    expect(res.status).toBe(201);
    const arg = prismaMock.presentation.create.mock.calls[0][0];
    expect(arg.data.slideCount).toBe(0);
  });

  it("객체 키가 presentations/ 밖이면 400 (위조 방지)", async () => {
    const res = await POST(
      req({
        title: "x",
        asset: {
          objectPath: "papers/secret.pdf",
          filename: "secret.pdf",
          size: "1MB",
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(prismaMock.presentation.create).not.toHaveBeenCalled();
  });
});
