import { beforeEach, describe, expect, it, vi } from "vitest";

// 대시보드 읽기 팀 스코핑(ADR-020/R37) — 카운트·최근 목록이 활성 팀 데이터만 센다.
// CRITICAL: 활성 팀이 A면 B의 논문/발표 자료가 카운트·최근 목록에 섞이지 않는다(R37).

interface Row {
  id: string;
  teamId: string;
  title: string;
  authors?: string;
  uploadedAt?: Date;
  date?: Date;
}

const { db } = vi.hoisted(() => ({
  db: { papers: [] as Row[], presentations: [] as Row[] },
}));

function ofTeam(rows: Row[], where: { teamId?: string } | undefined): Row[] {
  if (!where || where.teamId === undefined) return rows;
  return rows.filter((r) => r.teamId === where.teamId);
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paper: {
      count: vi.fn(async ({ where }: { where?: { teamId?: string } } = {}) =>
        ofTeam(db.papers, where).length,
      ),
      findMany: vi.fn(async ({ where }: { where?: { teamId?: string } } = {}) =>
        ofTeam(db.papers, where),
      ),
    },
    presentation: {
      count: vi.fn(async ({ where }: { where?: { teamId?: string } } = {}) =>
        ofTeam(db.presentations, where).length,
      ),
      findMany: vi.fn(async ({ where }: { where?: { teamId?: string } } = {}) =>
        ofTeam(db.presentations, where),
      ),
    },
  },
}));

import { getDashboardData } from "@/lib/dashboard";

beforeEach(() => {
  db.papers = [
    { id: "a1", teamId: "tA", title: "A논문1", authors: "x", uploadedAt: new Date("2026-06-01") },
    { id: "a2", teamId: "tA", title: "A논문2", authors: "y", uploadedAt: new Date("2026-06-02") },
    { id: "b1", teamId: "tB", title: "B논문", authors: "z", uploadedAt: new Date("2026-06-03") },
  ];
  db.presentations = [
    { id: "pa", teamId: "tA", title: "A발표", date: new Date("2026-06-01") },
    { id: "pb", teamId: "tB", title: "B발표", date: new Date("2026-06-02") },
  ];
});

describe("getDashboardData(teamId) — 교차 팀 격리", () => {
  it("활성 팀 A만 카운트하고 최근 목록도 A만 담는다", async () => {
    const data = await getDashboardData("tA");
    expect(data.paperCount).toBe(2);
    expect(data.presentationCount).toBe(1);
    expect(data.recentPapers.map((p) => p.id).sort()).toEqual(["a1", "a2"]);
    expect(data.recentPresentations.map((p) => p.id)).toEqual(["pa"]);
  });

  it("빈 팀이면 0 카운트·빈 목록", async () => {
    const data = await getDashboardData("tEmpty");
    expect(data.paperCount).toBe(0);
    expect(data.presentationCount).toBe(0);
    expect(data.recentPapers).toEqual([]);
    expect(data.recentPresentations).toEqual([]);
  });
});
