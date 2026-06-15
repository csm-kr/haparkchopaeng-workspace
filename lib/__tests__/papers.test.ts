import { beforeEach, describe, expect, it, vi } from "vitest";

// 논문 읽기 팀 스코핑(ADR-020/R37) — prisma 인메모리 목으로 교차 팀 격리를 검증한다.
// CRITICAL: 활성 팀이 A면 B의 논문이 절대 조회에 섞이지 않는다(R37). 단건은 다른 팀 id → null(404, 존재 숨김, R19).

interface PaperRow {
  id: string;
  teamId: string;
  title: string;
  authors: string;
  tags: unknown;
  analysisStatus: string;
  uploadedBy: string;
  uploadedAt: Date;
  venue: string | null;
  year: number | null;
  arxiv: string | null;
  pageCount: number | null;
  abstract: string | null;
  pdfUrl: string;
  analyses: Array<{ lens: string; payload: unknown }>;
  figures: unknown[];
  notes: unknown[];
}

const { db } = vi.hoisted(() => ({
  db: {
    papers: [] as PaperRow[],
    members: [] as Array<{
      id: string;
      name: string;
      initial: string;
      color: string;
    }>,
  },
}));

function matchTeam(rowTeam: string, whereTeam: unknown): boolean {
  // 구현이 teamId를 빠뜨리면(undefined) 격리가 깨진다 — 그 경우 모두 통과시켜 RED가 드러나게 한다.
  return whereTeam === undefined || rowTeam === whereTeam;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paper: {
      findMany: vi.fn(async ({ where }: { where?: { teamId?: string } } = {}) =>
        db.papers.filter((p) => matchTeam(p.teamId, where?.teamId)),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; teamId?: string } }) =>
          db.papers.find(
            (p) => p.id === where.id && matchTeam(p.teamId, where.teamId),
          ) ?? null,
      ),
      // 현재(미스코핑) 구현이 호출하던 경로 — RED가 에러가 아니라 fail로 드러나게 둔다.
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          db.papers.find((p) => p.id === where.id) ?? null,
      ),
    },
    member: {
      findMany: vi.fn(async () => db.members),
    },
  },
}));

import { getPapers, getPaperDetail } from "@/lib/papers";

function paper(id: string, teamId: string): PaperRow {
  return {
    id,
    teamId,
    title: `논문 ${id}`,
    authors: "저자",
    tags: ["RAG"],
    analysisStatus: "ready",
    uploadedBy: "ha",
    uploadedAt: new Date("2026-06-01T00:00:00Z"),
    venue: null,
    year: 2026,
    arxiv: null,
    pageCount: 10,
    abstract: null,
    pdfUrl: `papers/${id}.pdf`,
    analyses: [],
    figures: [],
    notes: [],
  };
}

beforeEach(() => {
  db.papers = [paper("a1", "tA"), paper("a2", "tA"), paper("b1", "tB")];
  db.members = [{ id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)" }];
});

describe("getPapers(teamId) — 교차 팀 격리", () => {
  it("활성 팀 A의 논문만 돌려준다(B 제외)", async () => {
    const list = await getPapers("tA");
    expect(list.map((p) => p.id).sort()).toEqual(["a1", "a2"]);
    expect(list.some((p) => p.id === "b1")).toBe(false);
  });

  it("빈 팀이면 빈 목록(에러 아님)", async () => {
    const list = await getPapers("tEmpty");
    expect(list).toEqual([]);
  });
});

describe("getPaperDetail(id, teamId) — 단건 교차 팀 차단", () => {
  it("활성 팀의 논문이면 상세를 돌려준다", async () => {
    const detail = await getPaperDetail("a1", "tA");
    expect(detail?.paper.id).toBe("a1");
  });

  it("다른 팀 논문 id면 null(존재 숨김 → 404)", async () => {
    const detail = await getPaperDetail("b1", "tA");
    expect(detail).toBeNull();
  });
});
