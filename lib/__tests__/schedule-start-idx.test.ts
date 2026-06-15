import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveStartIdx 팀 스코핑(ADR-020/R37) — 순번 연속은 같은 팀의 직전 저장월에서만 이어받는다.
// CRITICAL: where에 teamId가 들어가야 다른 팀의 저장월이 순번에 끼어들지 않는다.

const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { scheduleMonth: { findFirst: findFirstMock } },
}));

import { resolveStartIdx } from "@/lib/schedule";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveStartIdx(year, month, teamId)", () => {
  it("같은 팀의 직전 저장월만 조회한다(where에 teamId)", async () => {
    findFirstMock.mockResolvedValue({ rotationPointerAfter: 2 });
    const idx = await resolveStartIdx(2026, 8, "tA");
    expect(idx).toBe(2);
    const arg = findFirstMock.mock.calls[0][0];
    expect(arg.where.teamId).toBe("tA");
    expect(arg.where.saved).toBe(true);
  });

  it("직전 저장월이 없으면 0", async () => {
    findFirstMock.mockResolvedValue(null);
    expect(await resolveStartIdx(2026, 1, "tA")).toBe(0);
  });
});
