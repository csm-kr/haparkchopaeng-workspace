// @vitest-environment node
// 시드 결과 검증 — AC 순서상 migrate + db seed 이후 실행된다(dev.db 존재).
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

afterAll(async () => {
  await prisma.$disconnect();
});

// Supabase 공유 DB(ADR-016)로 전환한 뒤로는 같은 DB에 라이브 업로드/분석/노트/댓글이
// 섞인다. 시드 불변식은 전역 카운트가 아니라 시드 엔티티 ID 범위로 스코프해 검증한다
// (그래야 사용자가 논문을 올려도 깨지지 않는다). 관계/불변식 테스트는 ID 기반이라 그대로 둔다.
const SEED_PAPERS = ["p1", "p2", "p3", "p4", "p5"];
const SEED_PRES = ["pres1", "pres2", "pres3"];

describe("seed counts", () => {
  it("단일 워크스페이스 (ADR-007)", async () => {
    expect(await prisma.workspace.count()).toBe(1);
  });

  it("멤버 4인", async () => {
    expect(await prisma.member.count()).toBe(4);
  });

  it("논문 5건 — p5는 분석 없음(pending)", async () => {
    const inSeed = { id: { in: SEED_PAPERS } };
    expect(await prisma.paper.count({ where: inSeed })).toBe(5);
    expect(await prisma.paper.count({ where: { ...inSeed, analysisStatus: "ready" } })).toBe(4);
    expect(await prisma.paper.count({ where: { ...inSeed, analysisStatus: "pending" } })).toBe(1);
  });

  it("분석은 두 관점뿐 — research/repro만 (ADR-004)", async () => {
    const inSeed = { paperId: { in: SEED_PAPERS } };
    expect(await prisma.analysis.count({ where: inSeed })).toBe(8); // p1~p4 × {research, repro}
    const lenses = new Set((await prisma.analysis.findMany({ where: inSeed, select: { lens: true } })).map((a) => a.lens));
    expect([...lenses].sort()).toEqual(["repro", "research"]);
  });

  it("figures + section notes", async () => {
    expect(await prisma.figure.count({ where: { paperId: { in: SEED_PAPERS } } })).toBe(6);
    expect(await prisma.sectionNote.count({ where: { paperId: { in: SEED_PAPERS } } })).toBe(5);
    // figures 노트는 항상 any (ADR-005)
    const figureNotes = await prisma.sectionNote.findMany({ where: { paperId: { in: SEED_PAPERS }, sectionId: "figures" } });
    expect(figureNotes.every((n) => n.lens === "any")).toBe(true);
  });

  it("발표 자료 3건 + 댓글", async () => {
    expect(await prisma.presentation.count({ where: { id: { in: SEED_PRES } } })).toBe(3);
    expect(await prisma.comment.count({ where: { presentationId: { in: SEED_PRES } } })).toBe(4);
  });
});

describe("seed relations & invariants", () => {
  it("p1 — 분석 2종 + figure 3개 관계", async () => {
    const p1 = await prisma.paper.findUnique({
      where: { id: "p1" },
      include: { analyses: true, figures: true },
    });
    expect(p1?.analyses).toHaveLength(2);
    expect(p1?.figures).toHaveLength(3);
  });

  it("6월 스케줄만 저장 — 빈 달은 row 없음 (ADR-006)", async () => {
    const june = await prisma.scheduleMonth.findUnique({
      where: { year_month: { year: 2026, month: 6 } },
      include: { weeks: true },
    });
    expect(june?.weeks).toHaveLength(4);
    // 7월은 빈 달 — 자동 생성하지 않는다
    const july = await prisma.scheduleMonth.findUnique({
      where: { year_month: { year: 2026, month: 7 } },
    });
    expect(july).toBeNull();
  });

  it("active LiveSession을 시드하지 않음 (ADR-001 — 기본 라이브 없음)", async () => {
    expect(await prisma.liveSession.count({ where: { active: true } })).toBe(0);
  });

  it("2026 벌금 설정 + 멤버 장부 4건 — 누적 벌금 파생 확인", async () => {
    const config = await prisma.fineConfig.findUnique({
      where: { year: 2026 },
      include: { ledgers: true },
    });
    expect(config?.ledgers).toHaveLength(4);
    const jo = config?.ledgers.find((l) => l.memberId === "jo");
    // 누적 = missedPresenter*finePresenter + missedAbsent*fineAbsent (저장 안 함, 파생)
    const accrued =
      (jo?.missedPresenter ?? 0) * (config?.finePresenter ?? 0) +
      (jo?.missedAbsent ?? 0) * (config?.fineAbsent ?? 0);
    expect(accrued).toBe(40000);
  });
});
