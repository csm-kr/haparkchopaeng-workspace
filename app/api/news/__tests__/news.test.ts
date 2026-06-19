import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/news POST · [id] PATCH/DELETE 단위 테스트 — auth/active-team/prisma/storage 모킹.
// 검증: 미인증 401 · 활성 팀 없음 403 · teamId/createdBy 서버 주입(클라 위조 무시) ·
//       입력 검증(필수/범위/teaserImage 접두/링크 URL) · 교차 팀 404(R37) ·
//       삭제 시 teaserImage removeObject(best-effort).

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    publication: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { removeObjectMock } = vi.hoisted(() => ({ removeObjectMock: vi.fn() }));
vi.mock("@/lib/storage", () => ({ removeObject: removeObjectMock }));

import { HttpError } from "@/lib/http";
const { POST } = await import("@/app/api/news/route");
const { PATCH, DELETE } = await import("@/app/api/news/[id]/route");

const postReq = (body: unknown) =>
  new Request("http://localhost/api/news", {
    method: "POST",
    body: JSON.stringify(body),
  });
const patchReq = (body: unknown) =>
  new Request("http://localhost/api/news/n1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
const delReq = () =>
  new Request("http://localhost/api/news/n1", { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// 활성 팀 tA 스코프 — where.teamId가 일치할 때만 조회된다(교차 팀 격리, R37).
function scopedRow(row: {
  id: string;
  teamId: string;
  teaserImage: string | null;
}) {
  return async ({ where }: { where: { id: string; teamId: string } }) =>
    where.id === row.id && where.teamId === row.teamId ? row : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
  prismaMock.publication.create.mockResolvedValue({ id: "pub-new" });
  prismaMock.publication.update.mockResolvedValue({ id: "n1" });
  prismaMock.publication.delete.mockResolvedValue({});
  removeObjectMock.mockResolvedValue(undefined);
});

const valid = {
  title: "Favoring One Among Equals",
  venue: "WACV 2024",
  authors: "하수현, Jane Roe",
  year: 2024,
};

describe("POST /api/news", () => {
  it("미인증이면 401 (생성 안 함)", async () => {
    requireAuthMock.mockRejectedValue(
      new HttpError(401, "UNAUTHORIZED", "로그인이 필요해요."),
    );
    const res = await POST(postReq(valid));
    expect(res.status).toBe(401);
    expect(prismaMock.publication.create).not.toHaveBeenCalled();
  });

  it("활성 팀이 없으면 403 (생성 안 함)", async () => {
    getActiveTeamMock.mockResolvedValue(null);
    const res = await POST(postReq(valid));
    expect(res.status).toBe(403);
    expect(prismaMock.publication.create).not.toHaveBeenCalled();
  });

  it("teamId·createdBy를 세션/활성 팀에서 주입한다(클라 위조 무시)", async () => {
    const res = await POST(
      postReq({ ...valid, teamId: "해커팀", createdBy: "해커", month: 3 }),
    );
    expect(res.status).toBe(201);
    const arg = prismaMock.publication.create.mock.calls[0][0];
    expect(arg.data.teamId).toBe("tA"); // 클라 teamId 무시(R3/R37)
    expect(arg.data.createdBy).toBe("jo"); // 세션에서(R3)
    expect(arg.data.month).toBe(3);
  });

  it("links를 그대로 저장하고 기본은 빈 배열", async () => {
    const links = [{ label: "arXiv", url: "https://arxiv.org/abs/2401.00001" }];
    await POST(postReq({ ...valid, links }));
    expect(prismaMock.publication.create.mock.calls[0][0].data.links).toEqual(
      links,
    );

    prismaMock.publication.create.mockClear();
    await POST(postReq(valid));
    expect(prismaMock.publication.create.mock.calls[0][0].data.links).toEqual(
      [],
    );
  });

  it("teaserImage는 news/ 접두면 받고 아니면 400(임의 경로 차단)", async () => {
    const okRes = await POST(postReq({ ...valid, teaserImage: "news/abc.png" }));
    expect(okRes.status).toBe(201);
    expect(
      prismaMock.publication.create.mock.calls[0][0].data.teaserImage,
    ).toBe("news/abc.png");

    prismaMock.publication.create.mockClear();
    const badRes = await POST(
      postReq({ ...valid, teaserImage: "papers/secret.pdf" }),
    );
    expect(badRes.status).toBe(400);
    expect(prismaMock.publication.create).not.toHaveBeenCalled();
  });

  it.each([
    ["제목 누락", { venue: "v", authors: "a", year: 2024 }],
    ["학회 누락", { title: "t", authors: "a", year: 2024 }],
    ["저자 누락", { title: "t", venue: "v", year: 2024 }],
    ["month 범위 밖", { ...valid, month: 13 }],
    ["link url 비-URL", { ...valid, links: [{ label: "x", url: "not-a-url" }] }],
  ])("잘못된 입력(%s)은 400", async (_label, body) => {
    const res = await POST(postReq(body));
    expect(res.status).toBe(400);
    expect(prismaMock.publication.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/news/:id", () => {
  beforeEach(() => {
    prismaMock.publication.findFirst.mockImplementation(
      scopedRow({ id: "n1", teamId: "tA", teaserImage: null }),
    );
  });

  it("다른 팀 실적이면 404 (수정 안 함)", async () => {
    prismaMock.publication.findFirst.mockImplementation(
      scopedRow({ id: "n1", teamId: "tB", teaserImage: null }),
    );
    const res = await PATCH(patchReq({ title: "new" }), ctx("n1"));
    expect(res.status).toBe(404);
    expect(prismaMock.publication.update).not.toHaveBeenCalled();
  });

  it("부분 수정 — 보낸 필드만 바꾸고 teamId/createdBy는 무시", async () => {
    const res = await PATCH(
      patchReq({ title: "Updated", teamId: "해커팀", createdBy: "해커" }),
      ctx("n1"),
    );
    expect(res.status).toBe(200);
    const arg = prismaMock.publication.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "n1" });
    expect(arg.data.title).toBe("Updated");
    expect(arg.data).not.toHaveProperty("teamId");
    expect(arg.data).not.toHaveProperty("createdBy");
  });

  it("teaserImage가 news/ 아니면 400 (수정 안 함)", async () => {
    const res = await PATCH(patchReq({ teaserImage: "papers/x.pdf" }), ctx("n1"));
    expect(res.status).toBe(400);
    expect(prismaMock.publication.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/news/:id", () => {
  it("다른 팀 실적이면 404 (삭제 안 함)", async () => {
    prismaMock.publication.findFirst.mockImplementation(
      scopedRow({ id: "n1", teamId: "tB", teaserImage: "news/a.png" }),
    );
    const res = await DELETE(delReq(), ctx("n1"));
    expect(res.status).toBe(404);
    expect(prismaMock.publication.delete).not.toHaveBeenCalled();
    expect(removeObjectMock).not.toHaveBeenCalled();
  });

  it("teaserImage가 있으면 삭제 후 removeObject 호출(best-effort)", async () => {
    prismaMock.publication.findFirst.mockImplementation(
      scopedRow({ id: "n1", teamId: "tA", teaserImage: "news/a.png" }),
    );
    const res = await DELETE(delReq(), ctx("n1"));
    expect(res.status).toBe(200);
    expect(prismaMock.publication.delete).toHaveBeenCalledWith({
      where: { id: "n1" },
    });
    expect(removeObjectMock).toHaveBeenCalledWith("news/a.png");
  });

  it("teaserImage가 없으면 removeObject를 부르지 않는다", async () => {
    prismaMock.publication.findFirst.mockImplementation(
      scopedRow({ id: "n1", teamId: "tA", teaserImage: null }),
    );
    const res = await DELETE(delReq(), ctx("n1"));
    expect(res.status).toBe(200);
    expect(removeObjectMock).not.toHaveBeenCalled();
  });
});
