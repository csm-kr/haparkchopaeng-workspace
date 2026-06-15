import { beforeEach, describe, expect, it, vi } from "vitest";

// getActiveSession(teamId) 팀 스코핑(ADR-020/R37) — 라이브는 팀당 1개다.
// CRITICAL: where에 teamId가 들어가야 다른 팀의 active 세션이 섞이지 않는다.

const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { liveSession: { findFirst: findFirstMock } },
}));

import { getActiveSession } from "@/lib/live";

beforeEach(() => {
  vi.clearAllMocks();
  findFirstMock.mockResolvedValue(null);
});

describe("getActiveSession(teamId)", () => {
  it("active + teamId로 스코핑해 조회한다(팀당 1개)", async () => {
    await getActiveSession("tA");
    const arg = findFirstMock.mock.calls[0][0];
    expect(arg.where).toMatchObject({ active: true, teamId: "tA" });
  });

  it("없으면 null", async () => {
    expect(await getActiveSession("tA")).toBeNull();
  });
});
