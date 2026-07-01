import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 주간 업로드 한도 — Gemini 비용 통제용. 멤버별 "이번 주(월요일 00:00 KST 이후) 업로드한 Paper 수"로 판정한다.
// CRITICAL: 매주 월요일 0시(KST)에 0으로 리셋 — "이번 주"/"다음 주" 문구와 일치.
// CRITICAL: 기본은 운영(production)에서만 20편/주, 그 외(개발·자동테스트)는 무제한(테스트할 때 무제한 요구).
//   어디서든 PAPER_WEEKLY_LIMIT env로 조정/비활성(0 이하 = 무제한).

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { paper: { count: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { paperWeeklyLimit, isPaperQuotaExceeded, quotaStatus, startOfWeekKST } =
  await import("@/lib/rate-limit");

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

  it("해당 멤버의 이번 주(월요일 00:00 KST 이후) 업로드만 센다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T07:32:00Z")); // 수요일
    vi.stubEnv("PAPER_WEEKLY_LIMIT", "20");
    prismaMock.paper.count.mockResolvedValue(0);
    await isPaperQuotaExceeded("bak");
    const arg = prismaMock.paper.count.mock.calls[0][0];
    expect(arg.where.uploadedBy).toBe("bak");
    const gte = arg.where.uploadedAt.gte as Date;
    // 이번 주 월요일 00:00 KST = 2026-06-28T15:00:00Z 부터 집계.
    expect(gte.toISOString()).toBe("2026-06-28T15:00:00.000Z");
    vi.useRealTimers();
  });
});

describe("startOfWeekKST(월요일 00:00 KST 기준 주 시작)", () => {
  it("주중(수요일)이면 이번 주 월요일 00:00 KST를 돌려준다", () => {
    // 2026-07-01(수) 07:32 UTC → 이번 주 월요일 = 06-29 KST = 06-28T15:00Z
    expect(startOfWeekKST(new Date("2026-07-01T07:32:00Z")).toISOString()).toBe(
      "2026-06-28T15:00:00.000Z",
    );
  });

  it("월요일 00:00 KST 정각은 그 순간을 그대로 돌려준다(경계 포함)", () => {
    expect(startOfWeekKST(new Date("2026-06-28T15:00:00Z")).toISOString()).toBe(
      "2026-06-28T15:00:00.000Z",
    );
  });

  it("일요일 늦은 밤(KST)도 같은 주의 월요일을 돌려준다", () => {
    // 2026-07-05(일) 23:00 KST = 2026-07-05T14:00Z
    expect(startOfWeekKST(new Date("2026-07-05T14:00:00Z")).toISOString()).toBe(
      "2026-06-28T15:00:00.000Z",
    );
  });

  it("월요일 00:30 KST면 그 주 월요일 00:00을 돌려준다(새 주 시작)", () => {
    // 2026-07-06(월) 00:30 KST = 2026-07-05T15:30Z → 그 주 월요일 = 07-06 KST = 07-05T15:00Z
    expect(startOfWeekKST(new Date("2026-07-05T15:30:00Z")).toISOString()).toBe(
      "2026-07-05T15:00:00.000Z",
    );
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
