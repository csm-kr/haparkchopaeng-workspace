import { beforeEach, describe, expect, it, vi } from "vitest";

// NEWS 출판 실적 읽기 팀 스코핑(ADR-020/R37) + 저자 강조 순수 함수.
// prisma 인메모리 목으로 교차 팀 격리와 정렬(year desc, month desc — null 마지막)을 검증한다.
// CRITICAL: 활성 팀이 A면 B의 실적이 절대 조회에 섞이지 않는다(R37). 단건은 다른 팀 id → null(404, R19).

interface PubRow {
  id: string;
  teamId: string;
  title: string;
  authors: string;
  venue: string;
  year: number;
  month: number | null;
  teaserImage: string | null;
  links: unknown;
  createdBy: string;
  createdAt: Date;
}

const { db } = vi.hoisted(() => ({ db: { publications: [] as PubRow[] } }));

function matchTeam(rowTeam: string, whereTeam: unknown): boolean {
  return whereTeam === undefined || rowTeam === whereTeam;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    publication: {
      findMany: vi.fn(
        async ({ where }: { where?: { teamId?: string } } = {}) =>
          db.publications.filter((p) => matchTeam(p.teamId, where?.teamId)),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; teamId?: string } }) =>
          db.publications.find(
            (p) => p.id === where.id && matchTeam(p.teamId, where.teamId),
          ) ?? null,
      ),
    },
  },
}));

import { getPublications, getPublication, splitAuthors } from "@/lib/news";

function pub(id: string, teamId: string, over: Partial<PubRow> = {}): PubRow {
  return {
    id,
    teamId,
    title: `실적 ${id}`,
    authors: "조성민",
    venue: "NeurIPS 2025",
    year: 2025,
    month: 6,
    teaserImage: null,
    links: [],
    createdBy: "jo",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  db.publications = [pub("a1", "tA"), pub("a2", "tA"), pub("b1", "tB")];
});

describe("getPublications(teamId) — 교차 팀 격리", () => {
  it("활성 팀 A의 실적만 돌려준다(B 제외) + where.teamId 전달", async () => {
    const { prisma } = await import("@/lib/prisma");
    const list = await getPublications("tA");
    expect(list.map((p) => p.id).sort()).toEqual(["a1", "a2"]);
    expect(list.some((p) => p.id === "b1")).toBe(false);
    expect(prisma.publication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: "tA" } }),
    );
  });

  it("빈 팀이면 빈 목록(에러 아님)", async () => {
    expect(await getPublications("tEmpty")).toEqual([]);
  });

  it("year desc, month desc로 정렬하고 month=null은 마지막에 둔다", async () => {
    db.publications = [
      pub("p1", "tA", { year: 2024, month: 3 }),
      pub("p2", "tA", { year: 2025, month: null }),
      pub("p3", "tA", { year: 2025, month: 11 }),
      pub("p4", "tA", { year: 2025, month: 3 }),
    ];
    const list = await getPublications("tA");
    expect(list.map((p) => p.id)).toEqual(["p3", "p4", "p2", "p1"]);
  });

  it("links Json을 안전 파싱한다(형식 안 맞는 항목은 버린다)", async () => {
    db.publications = [
      pub("x", "tA", {
        links: [{ label: "arXiv", url: "https://a" }, { bad: 1 }, "nope", null],
      }),
    ];
    const [v] = await getPublications("tA");
    expect(v.links).toEqual([{ label: "arXiv", url: "https://a" }]);
  });

  it("links가 배열이 아니면 빈 배열로 둔다", async () => {
    db.publications = [pub("x", "tA", { links: { not: "array" } })];
    const [v] = await getPublications("tA");
    expect(v.links).toEqual([]);
  });
});

describe("getPublication(id, teamId) — 단건 교차 팀 차단", () => {
  it("활성 팀의 실적이면 뷰를 돌려준다", async () => {
    const detail = await getPublication("tA", "a1");
    expect(detail?.id).toBe("a1");
    expect(detail?.venue).toBe("NeurIPS 2025");
  });

  it("다른 팀 실적 id면 null(존재 숨김 → 404)", async () => {
    expect(await getPublication("tA", "b1")).toBeNull();
  });

  it("없는 id면 null", async () => {
    expect(await getPublication("tA", "nope")).toBeNull();
  });
});

describe("splitAuthors — 팀원 이름 강조", () => {
  const members = ["하수현", "박진희", "조성민", "팽진욱"];

  it("쉼표로 나누고 팀원 이름만 isMember=true", () => {
    const segs = splitAuthors("조성민, John Doe, 박진희", members);
    expect(segs).toEqual([
      { text: "조성민", isMember: true },
      { text: "John Doe", isMember: false },
      { text: "박진희", isMember: true },
    ]);
  });

  it("조각 앞뒤 공백을 trim하고 빈 조각은 버린다", () => {
    const segs = splitAuthors("  조성민 ,, ,  Jane  ", members);
    expect(segs).toEqual([
      { text: "조성민", isMember: true },
      { text: "Jane", isMember: false },
    ]);
  });

  it("빈 입력이면 빈 배열", () => {
    expect(splitAuthors("", members)).toEqual([]);
    expect(splitAuthors("   ", members)).toEqual([]);
  });
});
