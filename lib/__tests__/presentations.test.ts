import { beforeEach, describe, expect, it, vi } from "vitest";

// 발표 자료 읽기 팀 스코핑(ADR-020/R37) — prisma 인메모리 목으로 교차 팀 격리를 검증한다.
// CRITICAL: 활성 팀이 A면 B의 발표 자료가 절대 조회에 섞이지 않는다(R37). 단건은 다른 팀 id → null(404, R19).

interface PresRow {
  id: string;
  teamId: string;
  title: string;
  presenterId: string;
  date: Date;
  duration: string | null;
  slideCount: number;
  tags: unknown;
  summary: string | null;
  keypoints: unknown;
  slides: unknown;
  assets: unknown[];
  versions: unknown[];
  comments: unknown[];
}

const { db } = vi.hoisted(() => ({
  db: {
    presentations: [] as PresRow[],
    members: [] as Array<{
      id: string;
      name: string;
      handle: string;
      initial: string;
      color: string;
    }>,
  },
}));

function matchTeam(rowTeam: string, whereTeam: unknown): boolean {
  return whereTeam === undefined || rowTeam === whereTeam;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    presentation: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where?: { teamId?: string; assets?: { some?: { type?: string } } };
        } = {}) => {
          const someType = where?.assets?.some?.type;
          return db.presentations.filter(
            (p) =>
              matchTeam(p.teamId, where?.teamId) &&
              (someType === undefined ||
                (p.assets as Array<{ type?: string }>).some(
                  (a) => a.type === someType,
                )),
          );
        },
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; teamId?: string } }) =>
          db.presentations.find(
            (p) => p.id === where.id && matchTeam(p.teamId, where.teamId),
          ) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          db.presentations.find((p) => p.id === where.id) ?? null,
      ),
    },
    member: {
      findMany: vi.fn(async () => db.members),
    },
  },
}));

import {
  getPresentations,
  getPresentationDetail,
  getShareablePresentations,
  getTeamPresentationPdfPath,
} from "@/lib/presentations";

function pres(id: string, teamId: string): PresRow {
  return {
    id,
    teamId,
    title: `발표 ${id}`,
    presenterId: "jo",
    date: new Date("2026-06-01T00:00:00Z"),
    duration: "30분",
    slideCount: 0,
    tags: [],
    summary: null,
    keypoints: [],
    slides: [],
    assets: [],
    versions: [],
    comments: [],
  };
}

beforeEach(() => {
  db.presentations = [pres("a1", "tA"), pres("a2", "tA"), pres("b1", "tB")];
  db.members = [
    { id: "jo", name: "조성민", handle: "@jo", initial: "조", color: "var(--m-jo)" },
  ];
});

describe("getPresentations(teamId) — 교차 팀 격리", () => {
  it("활성 팀 A의 발표 자료만 돌려준다(B 제외)", async () => {
    const list = await getPresentations("tA");
    expect(list.map((p) => p.id).sort()).toEqual(["a1", "a2"]);
    expect(list.some((p) => p.id === "b1")).toBe(false);
  });

  it("빈 팀이면 빈 목록(에러 아님)", async () => {
    const list = await getPresentations("tEmpty");
    expect(list).toEqual([]);
  });
});

describe("getPresentationDetail(id, teamId) — 단건 교차 팀 차단", () => {
  it("활성 팀의 발표 자료면 상세를 돌려준다", async () => {
    const detail = await getPresentationDetail("a1", "tA");
    expect(detail?.presentation.id).toBe("a1");
  });

  it("다른 팀 발표 자료 id면 null(존재 숨김 → 404)", async () => {
    const detail = await getPresentationDetail("b1", "tA");
    expect(detail).toBeNull();
  });
});

describe("getShareablePresentations(teamId) — 라이브 공유 대상", () => {
  it("활성 팀 + PDF 자산 보유 자료만 {id,title}로 반환한다", async () => {
    db.presentations = [
      { ...pres("p1", "tA"), title: "MoD 세미나", assets: [{ type: "pdf", url: "presentations/p1.pdf" }] },
      { ...pres("p2", "tA"), title: "Q2 로드맵", assets: [{ type: "pdf", url: "presentations/p2.pdf" }] },
      { ...pres("p3", "tA"), title: "노트만", assets: [{ type: "note", url: "presentations/p3.txt" }] },
      { ...pres("b1", "tB"), title: "다른 팀", assets: [{ type: "pdf", url: "presentations/b1.pdf" }] },
    ];
    const out = await getShareablePresentations("tA");
    // PDF 없는 p3 제외, 다른 팀 b1 제외.
    expect(out).toEqual([
      { id: "p1", title: "MoD 세미나" },
      { id: "p2", title: "Q2 로드맵" },
    ]);
  });
});

describe("getTeamPresentationPdfPath(id, teamId)", () => {
  it("팀 소속 + PDF 자산이 있으면 그 객체 경로를 반환한다", async () => {
    db.presentations = [
      {
        ...pres("p1", "tA"),
        assets: [
          { type: "note", url: "presentations/p1.txt" },
          { type: "pdf", url: "presentations/p1.pdf" },
        ],
      },
    ];
    expect(await getTeamPresentationPdfPath("p1", "tA")).toBe("presentations/p1.pdf");
  });

  it("다른 팀 자료면 null(교차 팀 차단)", async () => {
    db.presentations = [
      { ...pres("b1", "tB"), assets: [{ type: "pdf", url: "presentations/b1.pdf" }] },
    ];
    expect(await getTeamPresentationPdfPath("b1", "tA")).toBeNull();
  });

  it("PDF 자산이 없으면 null", async () => {
    db.presentations = [
      { ...pres("p1", "tA"), assets: [{ type: "note", url: "presentations/p1.txt" }] },
    ];
    expect(await getTeamPresentationPdfPath("p1", "tA")).toBeNull();
  });
});
