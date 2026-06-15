// @vitest-environment node
// backfillTeamScoping 검증 — prisma 인메모리 목으로 (운영 DB 미접근, ADR-020).
// 검증: 부트스트랩 팀 선택(최초 createdAt) · "" 행 채움 · 멱등(2회) · 팀 0개 no-op ·
//       이미 다른 팀에 속한 행 미변경(다른 팀에 새지 않게).
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ScopedRow {
  teamId: string;
}
interface TeamRow {
  id: string;
  createdAt: Date;
}

const { db } = vi.hoisted(() => ({
  db: {
    teams: [] as TeamRow[],
    paper: [] as ScopedRow[],
    presentation: [] as ScopedRow[],
    scheduleMonth: [] as ScopedRow[],
    fineConfig: [] as ScopedRow[],
    memberLedger: [] as ScopedRow[],
    liveSession: [] as ScopedRow[],
  },
}));

vi.mock("@/lib/prisma", () => {
  // 같은 배열 참조에 바인딩 — beforeEach는 .length=0 + push로 in-place 갱신해야 한다.
  const updateMany = (rows: ScopedRow[]) =>
    vi.fn(async ({ where, data }: { where: { teamId: string }; data: { teamId: string } }) => {
      let count = 0;
      for (const r of rows) {
        if (r.teamId === where.teamId) {
          r.teamId = data.teamId;
          count++;
        }
      }
      return { count };
    });
  return {
    prisma: {
      team: {
        findFirst: vi.fn(async ({ orderBy }: { orderBy: { createdAt: "asc" | "desc" } }) => {
          const sorted = [...db.teams].sort((a, b) =>
            orderBy.createdAt === "asc"
              ? a.createdAt.getTime() - b.createdAt.getTime()
              : b.createdAt.getTime() - a.createdAt.getTime(),
          );
          return sorted[0] ?? null;
        }),
      },
      paper: { updateMany: updateMany(db.paper) },
      presentation: { updateMany: updateMany(db.presentation) },
      scheduleMonth: { updateMany: updateMany(db.scheduleMonth) },
      fineConfig: { updateMany: updateMany(db.fineConfig) },
      memberLedger: { updateMany: updateMany(db.memberLedger) },
      liveSession: { updateMany: updateMany(db.liveSession) },
    },
  };
});

import { backfillTeamScoping } from "@/lib/backfill-teams";

beforeEach(() => {
  db.teams.length = 0;
  for (const k of [
    "paper",
    "presentation",
    "scheduleMonth",
    "fineConfig",
    "memberLedger",
    "liveSession",
  ] as const) {
    db[k].length = 0;
  }
});

describe("backfillTeamScoping", () => {
  it("부트스트랩 팀(최초 createdAt)으로 빈('') teamId 행을 모두 채운다", async () => {
    // 나중 생성된 팀을 먼저 넣어도, createdAt 최소가 부트스트랩이어야 한다.
    db.teams.push({ id: "t-late", createdAt: new Date(2000) });
    db.teams.push({ id: "t-early", createdAt: new Date(1000) });
    db.paper.push({ teamId: "" }, { teamId: "" });
    db.presentation.push({ teamId: "" });
    db.scheduleMonth.push({ teamId: "" });
    db.fineConfig.push({ teamId: "" });
    db.memberLedger.push({ teamId: "" });
    db.liveSession.push({ teamId: "" }, { teamId: "" }, { teamId: "" });

    const res = await backfillTeamScoping();

    expect(res.team).toBe("t-early");
    expect(res.updated).toEqual({
      Paper: 2,
      Presentation: 1,
      ScheduleMonth: 1,
      FineConfig: 1,
      MemberLedger: 1,
      LiveSession: 3,
    });
    expect(db.paper.every((r) => r.teamId === "t-early")).toBe(true);
    expect(db.liveSession.every((r) => r.teamId === "t-early")).toBe(true);
  });

  it("멱등 — 두 번째 호출은 추가 변경 없음(동일 최종 상태)", async () => {
    db.teams.push({ id: "t1", createdAt: new Date(1000) });
    db.paper.push({ teamId: "" }, { teamId: "" });
    db.scheduleMonth.push({ teamId: "" });

    const first = await backfillTeamScoping();
    expect(first.updated.Paper).toBe(2);

    const second = await backfillTeamScoping();
    expect(second.team).toBe("t1");
    // 이미 채워졌으므로 두 번째는 0건 — 재변경 없음.
    expect(second.updated).toEqual({
      Paper: 0,
      Presentation: 0,
      ScheduleMonth: 0,
      FineConfig: 0,
      MemberLedger: 0,
      LiveSession: 0,
    });
    expect(db.paper.every((r) => r.teamId === "t1")).toBe(true);
  });

  it("팀이 0개면 no-op (안전) — 아무 행도 바꾸지 않는다", async () => {
    db.paper.push({ teamId: "" });
    db.scheduleMonth.push({ teamId: "" });

    const res = await backfillTeamScoping();

    expect(res.team).toBe("");
    expect(res.updated).toEqual({});
    expect(db.paper[0].teamId).toBe("");
    expect(db.scheduleMonth[0].teamId).toBe("");
  });

  it("이미 다른 팀에 속한 행은 건드리지 않는다(다른 팀에 새지 않게)", async () => {
    db.teams.push({ id: "boot", createdAt: new Date(1000) });
    db.paper.push({ teamId: "other" }, { teamId: "" });

    const res = await backfillTeamScoping();

    expect(res.updated.Paper).toBe(1); // "" 한 건만.
    expect(db.paper[0].teamId).toBe("other"); // 기존 다른 팀 유지.
    expect(db.paper[1].teamId).toBe("boot");
  });
});
