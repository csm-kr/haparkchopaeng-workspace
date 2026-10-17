import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), team: vi.fn(), find: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: mocks.team }));
vi.mock("@/lib/prisma", () => ({ prisma: { presentationAsset: { findFirst: mocks.find } } }));
vi.mock("@/lib/storage", () => ({ signedDownloadUrl: mocks.sign }));
const { GET } = await import("../route");
const request = () => GET(new Request("http://localhost/api/presentations/p1/assets/a1"), {
  params: Promise.resolve({ id: "p1", assetId: "a1" }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ memberId: "member-a" });
  mocks.team.mockResolvedValue({ id: "team-a", role: "member" });
  mocks.sign.mockResolvedValue("https://storage.example.test/signed.pdf");
});

describe("발표자료 첨부 다운로드 권한", () => {
  it("다른 팀 자료는 찾을 수 없음으로 응답하고 서명하지 않는다", async () => {
    mocks.find.mockImplementation(async ({ where }) =>
      where.presentation?.teamId === "team-a" ? null : { url: "presentations/team-b/private.pdf" },
    );
    expect((await request()).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("활성 팀이 없으면 자료를 조회하거나 서명하지 않는다", async () => {
    mocks.team.mockResolvedValue(null);
    expect((await request()).status).toBe(403);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("자기 팀 자료만 단기 서명 URL로 보낸다", async () => {
    mocks.find.mockResolvedValue({ url: "presentations/team-a/own.pdf" });
    const response = await request();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://storage.example.test/signed.pdf");
    expect(mocks.sign).toHaveBeenCalledWith("presentations/team-a/own.pdf", 60);
  });

  it("없는 첨부에는 서명 URL을 발급하지 않는다", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("로그인하지 않으면 팀이나 자료를 조회하지 않는다", async () => {
    mocks.auth.mockRejectedValue(new HttpError(401, "UNAUTHORIZED", "로그인이 필요해요."));
    expect((await request()).status).toBe(401);
    expect(mocks.team).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
  });
});
