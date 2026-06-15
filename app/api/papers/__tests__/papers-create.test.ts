import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/papers 팀 스코핑(ADR-020/R37) — 생성 teamId는 활성 팀에서 주입한다(클라 미신뢰, R3).
// 검증: 활성 팀 없으면 403 · arXiv/파일 경로 모두 teamId=활성 팀으로 create · 업로더 세션 주입.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { paper: { create: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { parseArxivIdMock, arxivPdfUrlMock } = vi.hoisted(() => ({
  parseArxivIdMock: vi.fn(),
  arxivPdfUrlMock: vi.fn(),
}));
vi.mock("@/lib/arxiv", () => ({
  parseArxivId: parseArxivIdMock,
  arxivPdfUrl: arxivPdfUrlMock,
}));

const { uploadPdfMock, signedDownloadUrlMock, removeObjectMock } = vi.hoisted(
  () => ({
    uploadPdfMock: vi.fn(),
    signedDownloadUrlMock: vi.fn(),
    removeObjectMock: vi.fn(),
  }),
);
vi.mock("@/lib/storage", () => ({
  uploadPdf: uploadPdfMock,
  signedDownloadUrl: signedDownloadUrlMock,
  removeObject: removeObjectMock,
}));

const { isPaperQuotaExceededMock, paperWeeklyLimitMock } = vi.hoisted(() => ({
  isPaperQuotaExceededMock: vi.fn(),
  paperWeeklyLimitMock: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  isPaperQuotaExceeded: isPaperQuotaExceededMock,
  paperWeeklyLimit: paperWeeklyLimitMock,
}));

const { countPdfPagesMock } = vi.hoisted(() => ({ countPdfPagesMock: vi.fn() }));
vi.mock("@/lib/pdf", () => ({ countPdfPages: countPdfPagesMock }));

const { inngestSendMock } = vi.hoisted(() => ({ inngestSendMock: vi.fn() }));
vi.mock("@/lib/inngest", () => ({ inngest: { send: inngestSendMock } }));

const { POST } = await import("@/app/api/papers/route");

const req = (body: unknown) =>
  new Request("http://localhost/api/papers", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
  isPaperQuotaExceededMock.mockResolvedValue(false);
  paperWeeklyLimitMock.mockReturnValue(20);
  countPdfPagesMock.mockResolvedValue(10);
  inngestSendMock.mockResolvedValue(undefined);
  prismaMock.paper.create.mockResolvedValue({
    id: "p-new",
    analysisStatus: "pending",
  });
  uploadPdfMock.mockResolvedValue(undefined);
  // 파일 경로용 fetch: 서명 URL을 받아 PDF 바이트를 내려받는다.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      headers: { get: () => "application/pdf" },
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
});

describe("POST /api/papers — teamId 활성 팀 주입(R3/R37)", () => {
  it("활성 팀이 없으면 403 (생성 안 함)", async () => {
    getActiveTeamMock.mockResolvedValue(null);
    const res = await POST(req({ arxivUrl: "https://arxiv.org/abs/2404.02258" }));
    expect(res.status).toBe(403);
    expect(prismaMock.paper.create).not.toHaveBeenCalled();
  });

  it("arXiv 경로: teamId=활성 팀, uploadedBy=세션", async () => {
    parseArxivIdMock.mockReturnValue("2404.02258");
    arxivPdfUrlMock.mockReturnValue("https://arxiv.org/pdf/2404.02258");

    const res = await POST(
      req({ arxivUrl: "https://arxiv.org/abs/2404.02258", teamId: "해커팀" }),
    );
    expect(res.status).toBe(201);
    const data = prismaMock.paper.create.mock.calls[0][0].data;
    expect(data.teamId).toBe("tA"); // 클라가 보낸 teamId 무시(R3)
    expect(data.uploadedBy).toBe("jo");
  });

  it("파일 경로: teamId=활성 팀로 create", async () => {
    signedDownloadUrlMock.mockResolvedValue("https://store/sign?token=abc");
    const res = await POST(
      req({ objectPath: "papers/x.pdf", filename: "x.pdf" }),
    );
    expect(res.status).toBe(201);
    const data = prismaMock.paper.create.mock.calls[0][0].data;
    expect(data.teamId).toBe("tA");
    expect(data.uploadedBy).toBe("jo");
  });
});
