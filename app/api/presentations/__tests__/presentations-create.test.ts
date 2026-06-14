import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/presentations 단위 테스트 — auth/prisma 모킹.
// 검증: 제목 필수·발표자 세션 주입(클라 presenterId 무시)·첨부 자료 생성·타입 유도·객체 키 위조 방지.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { presentation: { create: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

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
});

describe("POST /api/presentations", () => {
  it("제목이 비면 400 (생성 안 함)", async () => {
    const res = await POST(req({ title: "  " }));
    expect(res.status).toBe(400);
    expect(prismaMock.presentation.create).not.toHaveBeenCalled();
  });

  it("발표자는 세션에서 취하고 생성한다(클라 presenterId 무시)", async () => {
    const res = await POST(req({ title: "MoD 리뷰", presenterId: "해커" }));
    expect(res.status).toBe(201);
    const arg = prismaMock.presentation.create.mock.calls[0][0];
    expect(arg.data.presenterId).toBe("ha");
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
