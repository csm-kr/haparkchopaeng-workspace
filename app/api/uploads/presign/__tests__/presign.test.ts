import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/uploads/presign — kind별 분기 단위 테스트(auth/storage 모킹).
// 검증: news는 이미지 확장자만 → news/ 키, 비이미지 415, 기존 paper/presentation 회귀.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { ensureBucketMock, createSignedUploadUrlMock } = vi.hoisted(() => ({
  ensureBucketMock: vi.fn(),
  createSignedUploadUrlMock: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  ensureBucket: ensureBucketMock,
  createSignedUploadUrl: createSignedUploadUrlMock,
}));

const { POST } = await import("@/app/api/uploads/presign/route");

const req = (body: unknown) =>
  new Request("http://localhost/api/uploads/presign", {
    method: "POST",
    body: JSON.stringify(body),
  });

async function pathOf(res: Response): Promise<string> {
  const json = (await res.json()) as { data: { path: string } };
  return json.data.path;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ memberId: "ha", role: "멤버" });
  ensureBucketMock.mockResolvedValue(undefined);
  // path를 그대로 돌려주어 접두/확장자를 검증할 수 있게 한다.
  createSignedUploadUrlMock.mockImplementation(async (path: string) => ({
    uploadUrl: "https://signed.example/upload",
    path,
  }));
});

describe("POST /api/uploads/presign — news 종류", () => {
  it.each(["teaser.png", "shot.jpg", "shot.jpeg", "cover.webp"])(
    "이미지(%s)면 news/ 키를 발급한다",
    async (filename) => {
      const res = await POST(req({ filename, kind: "news" }));
      expect(res.status).toBe(200);
      const path = await pathOf(res);
      const ext = filename.split(".").pop();
      expect(path).toMatch(new RegExp(`^news/[^/]+\\.${ext}$`));
    },
  );

  it("비이미지(pdf)면 415 (서명 안 함)", async () => {
    const res = await POST(req({ filename: "paper.pdf", kind: "news" }));
    expect(res.status).toBe(415);
    expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/uploads/presign — 기존 종류 회귀", () => {
  it("paper 기본은 PDF → papers/ 키", async () => {
    const res = await POST(req({ filename: "x.pdf" }));
    expect(res.status).toBe(200);
    expect(await pathOf(res)).toMatch(/^papers\/[^/]+\.pdf$/);
  });

  it("presentation은 PPTX 허용 → presentations/ 키", async () => {
    const res = await POST(req({ filename: "deck.pptx", kind: "presentation" }));
    expect(res.status).toBe(200);
    expect(await pathOf(res)).toMatch(/^presentations\/[^/]+\.pptx$/);
  });

  it("paper에 이미지면 415", async () => {
    const res = await POST(req({ filename: "x.png" }));
    expect(res.status).toBe(415);
  });
});
