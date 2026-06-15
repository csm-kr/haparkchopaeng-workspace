import { beforeEach, describe, expect, it, vi } from "vitest";

// acceptInviteAction 단위 테스트 — auth/invite 도메인 모킹.
// 검증: 미인증 거부 · memberId 세션 주입(R3) · 성공 시 teamSlug · HttpError → 판별 유니온.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { acceptInviteMock } = vi.hoisted(() => ({ acceptInviteMock: vi.fn() }));
vi.mock("@/lib/invite", () => ({ acceptInvite: acceptInviteMock }));

import { HttpError } from "@/lib/http";
const { acceptInviteAction } = await import("@/app/invite/[token]/actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("acceptInviteAction", () => {
  it("미인증이면 합류하지 않고 UNAUTHORIZED", async () => {
    requireAuthMock.mockRejectedValue(new HttpError(401, "UNAUTHORIZED", "x"));
    const result = await acceptInviteAction("tk");
    expect(result).toEqual({ ok: false, code: "UNAUTHORIZED", message: "로그인이 필요해요." });
    expect(acceptInviteMock).not.toHaveBeenCalled();
  });

  it("memberId를 세션에서 취해 합류하고 teamSlug를 돌려준다(클라 입력 미신뢰)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    acceptInviteMock.mockResolvedValue({ teamSlug: "crew", alreadyMember: false });
    const result = await acceptInviteAction("tk");
    expect(acceptInviteMock).toHaveBeenCalledWith({ token: "tk", memberId: "jo" });
    expect(result).toEqual({ ok: true, teamSlug: "crew" });
  });

  it("HttpError(used_up)는 코드·메시지로 변환한다", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "x", role: "멤버" });
    acceptInviteMock.mockRejectedValue(new HttpError(409, "used_up", "이 초대는 모두 사용되었어요."));
    const result = await acceptInviteAction("tk");
    expect(result).toEqual({ ok: false, code: "used_up", message: "이 초대는 모두 사용되었어요." });
  });
});
