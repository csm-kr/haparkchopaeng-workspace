import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 라이브 사용량 추정(ADR-022)을 prisma 인메모리 목으로 검증한다.
// 단위는 참가자-분 — 4명이 30분이면 120분(LiveKit 과금 개념과 동일).
// CRITICAL: 월 경계는 KST 1일 00:00. 세션이 월을 걸치면 joinedAt이 속한 달에 전액 귀속한다.

interface ParticipantRow {
  joinedAt: Date;
  leftAt: Date | null;
  session: { endedAt: Date | null; teamId: string };
}
interface TeamRow {
  id: string;
  name: string;
}

const { db } = vi.hoisted(() => ({
  db: { participants: [] as ParticipantRow[], teams: [] as TeamRow[] },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    participant: {
      findMany: vi.fn(async ({ where }: { where: { joinedAt: { gte: Date } } }) =>
        db.participants.filter((p) => p.joinedAt >= where.joinedAt.gte),
      ),
    },
    team: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        db.teams.filter((t) => where.id.in.includes(t.id)),
      ),
    },
  },
}));

const {
  currentMonthUsage,
  liveMinutesQuota,
  monthKeyKST,
  monthlyTrend,
  spanMinutes,
  startOfMonthKST,
} = await import("@/lib/live-usage");

const ORIGINAL_QUOTA = process.env.LIVE_MINUTES_QUOTA;

/** KST 벽시계 → 실제 UTC 순간. 테스트 가독성용. */
function kst(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
}

beforeEach(() => {
  db.participants.length = 0;
  db.teams.length = 0;
  delete process.env.LIVE_MINUTES_QUOTA;
});

afterEach(() => {
  if (ORIGINAL_QUOTA === undefined) delete process.env.LIVE_MINUTES_QUOTA;
  else process.env.LIVE_MINUTES_QUOTA = ORIGINAL_QUOTA;
});

describe("startOfMonthKST()", () => {
  it("이번 달 1일 00:00 KST의 UTC 순간을 준다", () => {
    expect(startOfMonthKST(kst(2026, 8, 17, 13, 30))).toEqual(kst(2026, 8, 1));
  });

  it("1일 00:00 KST 정각은 그 순간 그대로(경계 포함)", () => {
    expect(startOfMonthKST(kst(2026, 8, 1))).toEqual(kst(2026, 8, 1));
  });

  it("연말 경계 — 1월은 그 해 1월 1일", () => {
    expect(startOfMonthKST(kst(2026, 1, 3))).toEqual(kst(2026, 1, 1));
  });

  it("KST 1일 00:30은 UTC로는 전달 말일이지만 이번 달로 친다", () => {
    expect(startOfMonthKST(kst(2026, 8, 1, 0, 30))).toEqual(kst(2026, 8, 1));
  });
});

describe("monthKeyKST()", () => {
  it('KST 기준 "YYYY-MM"', () => {
    expect(monthKeyKST(kst(2026, 8, 1, 0, 30))).toBe("2026-08");
    expect(monthKeyKST(kst(2026, 12, 31, 23, 0))).toBe("2026-12");
  });
});

describe("liveMinutesQuota()", () => {
  it("미설정이면 1000", () => {
    expect(liveMinutesQuota()).toBe(1000);
  });

  it("호출 시점에 env를 읽는다(R2)", () => {
    process.env.LIVE_MINUTES_QUOTA = "5000";
    expect(liveMinutesQuota()).toBe(5000);
  });

  it("잘못된 값이면 1000으로 폴백", () => {
    process.env.LIVE_MINUTES_QUOTA = "abc";
    expect(liveMinutesQuota()).toBe(1000);
  });
});

describe("spanMinutes()", () => {
  const now = kst(2026, 8, 17, 12, 0);

  it("leftAt이 있으면 leftAt − joinedAt", () => {
    const p = {
      joinedAt: kst(2026, 8, 17, 10, 0),
      leftAt: kst(2026, 8, 17, 10, 30),
      session: { endedAt: null, teamId: "t1" },
    };
    expect(spanMinutes(p, now)).toBe(30);
  });

  it("leftAt이 없고 세션이 끝났으면 endedAt으로 보정한다", () => {
    const p = {
      joinedAt: kst(2026, 8, 17, 10, 0),
      leftAt: null,
      session: { endedAt: kst(2026, 8, 17, 10, 45), teamId: "t1" },
    };
    expect(spanMinutes(p, now)).toBe(45);
  });

  it("leftAt도 endedAt도 없으면(진행 중) now로 보정한다", () => {
    const p = {
      joinedAt: kst(2026, 8, 17, 11, 0),
      leftAt: null,
      session: { endedAt: null, teamId: "t1" },
    };
    expect(spanMinutes(p, now)).toBe(60);
  });

  it("끝이 시작보다 앞서면 0으로 클램프한다", () => {
    const p = {
      joinedAt: kst(2026, 8, 17, 10, 0),
      leftAt: kst(2026, 8, 17, 9, 0),
      session: { endedAt: null, teamId: "t1" },
    };
    expect(spanMinutes(p, now)).toBe(0);
  });
});

describe("currentMonthUsage()", () => {
  const now = kst(2026, 8, 17, 12, 0);

  it("세션이 없으면 0분", async () => {
    const u = await currentMonthUsage(now);
    expect(u.usedMinutes).toBe(0);
    expect(u.limitMinutes).toBe(1000);
    expect(u.remainingMinutes).toBe(1000);
    expect(u.byTeam).toEqual([]);
  });

  it("참가자 3명 × 10분 = 30분(참가자-분)", async () => {
    db.teams.push({ id: "t1", name: "하박조팽" });
    for (let i = 0; i < 3; i++) {
      db.participants.push({
        joinedAt: kst(2026, 8, 10, 20, 0),
        leftAt: kst(2026, 8, 10, 20, 10),
        session: { endedAt: kst(2026, 8, 10, 20, 10), teamId: "t1" },
      });
    }
    const u = await currentMonthUsage(now);
    expect(u.usedMinutes).toBe(30);
    expect(u.remainingMinutes).toBe(970);
    expect(u.byTeam).toEqual([{ teamId: "t1", teamName: "하박조팽", minutes: 30 }]);
  });

  it("지난달 참가자는 제외한다", async () => {
    db.teams.push({ id: "t1", name: "하박조팽" });
    db.participants.push({
      joinedAt: kst(2026, 7, 31, 23, 0),
      leftAt: kst(2026, 7, 31, 23, 30),
      session: { endedAt: kst(2026, 7, 31, 23, 30), teamId: "t1" },
    });
    expect((await currentMonthUsage(now)).usedMinutes).toBe(0);
  });

  it("팀별 분해 합이 전체 합과 같고, 많이 쓴 팀이 앞에 온다", async () => {
    db.teams.push({ id: "t1", name: "하박조팽" }, { id: "t2", name: "비전랩" });
    db.participants.push({
      joinedAt: kst(2026, 8, 5, 9, 0),
      leftAt: kst(2026, 8, 5, 9, 20),
      session: { endedAt: kst(2026, 8, 5, 9, 20), teamId: "t1" },
    });
    db.participants.push({
      joinedAt: kst(2026, 8, 6, 9, 0),
      leftAt: kst(2026, 8, 6, 10, 0),
      session: { endedAt: kst(2026, 8, 6, 10, 0), teamId: "t2" },
    });
    const u = await currentMonthUsage(now);
    expect(u.usedMinutes).toBe(80);
    expect(u.byTeam.reduce((s, t) => s + t.minutes, 0)).toBe(80);
    expect(u.byTeam[0]).toEqual({ teamId: "t2", teamName: "비전랩", minutes: 60 });
  });

  it("한도를 넘겨도 remaining은 0 아래로 안 간다", async () => {
    process.env.LIVE_MINUTES_QUOTA = "10";
    db.teams.push({ id: "t1", name: "하박조팽" });
    db.participants.push({
      joinedAt: kst(2026, 8, 5, 9, 0),
      leftAt: kst(2026, 8, 5, 10, 0),
      session: { endedAt: kst(2026, 8, 5, 10, 0), teamId: "t1" },
    });
    const u = await currentMonthUsage(now);
    expect(u.usedMinutes).toBe(60);
    expect(u.remainingMinutes).toBe(0);
  });

  it("팀이 삭제돼 이름을 못 찾으면 '(삭제된 팀)'으로 표시한다", async () => {
    db.participants.push({
      joinedAt: kst(2026, 8, 5, 9, 0),
      leftAt: kst(2026, 8, 5, 9, 5),
      session: { endedAt: kst(2026, 8, 5, 9, 5), teamId: "gone" },
    });
    const u = await currentMonthUsage(now);
    expect(u.byTeam[0].teamName).toBe("(삭제된 팀)");
  });
});

describe("monthlyTrend()", () => {
  const now = kst(2026, 8, 17, 12, 0);

  it("사용 없는 달도 0으로 채우고 오래된 달부터 정렬한다", async () => {
    const t = await monthlyTrend(3, now);
    expect(t.map((x) => x.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(t.every((x) => x.minutes === 0)).toBe(true);
  });

  it("joinedAt이 속한 달에 귀속한다", async () => {
    db.participants.push({
      joinedAt: kst(2026, 7, 10, 9, 0),
      leftAt: kst(2026, 7, 10, 9, 30),
      session: { endedAt: kst(2026, 7, 10, 9, 30), teamId: "t1" },
    });
    const t = await monthlyTrend(3, now);
    expect(t.find((x) => x.month === "2026-07")?.minutes).toBe(30);
    expect(t.find((x) => x.month === "2026-08")?.minutes).toBe(0);
  });

  it("월을 걸친 세션은 joinedAt의 달에 전액 귀속한다(분할 안 함)", async () => {
    db.participants.push({
      joinedAt: kst(2026, 7, 31, 23, 30),
      leftAt: kst(2026, 8, 1, 0, 30),
      session: { endedAt: kst(2026, 8, 1, 0, 30), teamId: "t1" },
    });
    const t = await monthlyTrend(3, now);
    expect(t.find((x) => x.month === "2026-07")?.minutes).toBe(60);
    expect(t.find((x) => x.month === "2026-08")?.minutes).toBe(0);
  });
});
