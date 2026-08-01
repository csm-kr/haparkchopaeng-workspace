import { beforeEach, expect, it, vi } from "vitest";

// 상한 조절 Server Action 검증: 권한(R19) · 범위 · 현재 팀 수 하회 금지 · 판별 유니온(R30).
// CRITICAL: 권한 실패는 403이 아니라 NOT_FOUND — 콘솔 존재를 숨긴다.

const { requireSuperAdminMock, setMaxTeamsMock, teamCountMock } = vi.hoisted(() => ({
  requireSuperAdminMock: vi.fn(),
  setMaxTeamsMock: vi.fn(),
  teamCountMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireSuperAdmin: requireSuperAdminMock }));
vi.mock("@/lib/settings", () => ({
  setMaxTeams: setMaxTeamsMock,
  MAX_TEAMS_MIN: 1,
  MAX_TEAMS_MAX: 100,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { team: { count: teamCountMock } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setMaxTeamsAction } = await import("../actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperAdminMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
  teamCountMock.mockResolvedValue(2);
});

it("관리자가 아니면 NOT_FOUND를 돌려준다(던지지 않음)", async () => {
  requireSuperAdminMock.mockRejectedValue(new Error("nope"));
  await expect(setMaxTeamsAction({ value: 5 })).resolves.toEqual({
    ok: false,
    code: "NOT_FOUND",
    message: "페이지를 찾을 수 없어요.",
  });
  expect(setMaxTeamsMock).not.toHaveBeenCalled();
});

it("정상 값이면 저장하고 ok를 돌려준다", async () => {
  await expect(setMaxTeamsAction({ value: 5 })).resolves.toEqual({ ok: true, value: 5 });
  // updatedBy는 클라 입력이 아니라 세션에서(R3).
  expect(setMaxTeamsMock).toHaveBeenCalledWith(5, "ha");
});

it("현재 팀 수보다 작으면 BELOW_CURRENT", async () => {
  teamCountMock.mockResolvedValue(3);
  const r = await setMaxTeamsAction({ value: 2 });
  expect(r).toMatchObject({ ok: false, code: "BELOW_CURRENT" });
  expect(r.ok === false && r.message).toContain("3개");
  expect(setMaxTeamsMock).not.toHaveBeenCalled();
});

it("현재 팀 수와 같은 값은 허용한다(경계)", async () => {
  teamCountMock.mockResolvedValue(3);
  await expect(setMaxTeamsAction({ value: 3 })).resolves.toEqual({ ok: true, value: 3 });
});

it("0 이하는 INVALID_RANGE", async () => {
  await expect(setMaxTeamsAction({ value: 0 })).resolves.toMatchObject({
    ok: false,
    code: "INVALID_RANGE",
  });
});

it("100 초과는 INVALID_RANGE", async () => {
  await expect(setMaxTeamsAction({ value: 101 })).resolves.toMatchObject({
    ok: false,
    code: "INVALID_RANGE",
  });
});

it("정수가 아니면 INVALID_RANGE", async () => {
  await expect(setMaxTeamsAction({ value: 2.5 })).resolves.toMatchObject({
    ok: false,
    code: "INVALID_RANGE",
  });
});
