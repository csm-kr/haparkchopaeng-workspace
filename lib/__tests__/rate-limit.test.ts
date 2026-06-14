import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 주간 업로드 한도 — Gemini 비용 통제용. 멤버별 "최근 7일 업로드한 Paper 수"로 판정한다.
// CRITICAL: 기본은 운영(production)에서만 20편/주, 그 외(개발·자동테스트)는 무제한(테스트할 때 무제한 요구).
//   어디서든 PAPER_WEEKLY_LIMIT env로 조정/비활성(0 이하 = 무제한).

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { paper: { count: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { paperWeeklyLimit, isPaperQuotaExceeded, quotaStatus } = await import("@/lib/rate-limit");

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("paperWeeklyLimit", () => {
  it("운영(production) 기본값은 20편", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "");
    expect(paperWeeklyLimit()).toBe(20);
  });

  it("운영이 아니면 기본값은 0(무제한)", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "");
    expect(paperWeeklyLimit()).toBe(0);
  });

  it("PAPER_WEEKLY_LIMIT env가 있으면 그 값을 쓴다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "5");
    expect(paperWeeklyLimit()).toBe(5);
  });
});

describe("isPaperQuotaExceeded", () => {
  it("한도가 0 이하(무제한)면 DB 조회 없이 false", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "0");
    expect(await isPaperQuotaExceeded("ha")).toBe(false);
    expect(prismaMock.paper.count).not.toHaveBeenCalled();
  });

  it("최근 7일 업로드 수가 한도 미만이면 false", async () => {
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "20");
    prismaMock.paper.count.mockResolvedValue(19);
    expect(await isPaperQuotaExceeded("ha")).toBe(false);
  });

  it("한도 이상이면 true", async () => {
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "20");
    prismaMock.paper.count.mockResolvedValue(20);
    expect(await isPaperQuotaExceeded("ha")).toBe(true);
  });

  it("해당 멤버의 최근 7일 업로드만 센다", async () => {
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "20");
    prismaMock.paper.count.mockResolvedValue(0);
    const before = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await isPaperQuotaExceeded("bak");
    const arg = prismaMock.paper.count.mock.calls[0][0];
    expect(arg.where.uploadedBy).toBe("bak");
    const since = arg.where.uploadedAt.gte as Date;
    // 대략 7일 전(±2초) 시점부터 집계.
    expect(Math.abs(since.getTime() - before)).toBeLessThan(2000);
  });
});

describe("quotaStatus", () => {
  it("운영 한도에서 used·remaining을 돌려준다", async () => {
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "20");
    prismaMock.paper.count.mockResolvedValue(7);
    expect(await quotaStatus("ha")).toEqual({ limit: 20, used: 7, remaining: 13 });
  });

  it("한도를 넘겨도 remaining은 0(음수 아님)", async () => {
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "20");
    prismaMock.paper.count.mockResolvedValue(25);
    expect((await quotaStatus("ha")).remaining).toBe(0);
  });

  it("무제한(한도≤0)이면 remaining=null, used는 집계", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "0");
    prismaMock.paper.count.mockResolvedValue(3);
    expect(await quotaStatus("ha")).toEqual({ limit: 0, used: 3, remaining: null });
  });
});
