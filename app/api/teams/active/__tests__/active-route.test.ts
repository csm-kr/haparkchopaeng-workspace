import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/teams/active — 활성 팀 전환(ADR-020/R37). auth/active-team/next-cache 모킹.
// 검증: 미멤버십 slug → 403(setActiveTeam이 거부), 성공 → setActiveTeam 호출 + revalidate, slug 없으면 400.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { setActiveTeamMock } = vi.hoisted(() => ({ setActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ setActiveTeam: setActiveTeamMock }));

const { revalidatePathMock } = vi.hoisted(() => ({ revalidatePathMock: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { HttpError } from "@/lib/http";
const { POST } = await import("@/app/api/teams/active/route");

const req = (body: unknown) =>
  new Request("http://localhost/api/teams/active", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
  setActiveTeamMock.mockResolvedValue(undefined);
});

describe("POST /api/teams/active", () => {
  it("slug가 없으면 400 (전환하지 않음)", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(setActiveTeamMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("성공하면 세션 memberId로 setActiveTeam 호출 + revalidate", async () => {
    const res = await POST(req({ slug: "alpha" }));
    expect(res.status).toBe(200);
    expect(setActiveTeamMock).toHaveBeenCalledWith("ha", "alpha");
    expect(revalidatePathMock).toHaveBeenCalled();
  });

  it("미멤버십 slug는 403 (setActiveTeam이 거부) + revalidate 안 함", async () => {
    setActiveTeamMock.mockRejectedValue(new HttpError(403, "FORBIDDEN", "그 팀의 멤버가 아니에요."));
    const res = await POST(req({ slug: "gamma" }));
    expect(res.status).toBe(403);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
