// @vitest-environment node
// 시드 결과 검증 — migrate + db seed 이후 실행된다. 깨끗한 시작 상태(단일 워크스페이스 + 관리자 1명).
// 공유 Supabase DB(ADR-016)라 관리자가 멤버를 초대하면 멤버 수는 늘 수 있으므로,
// 가변 카운트가 아니라 '워크스페이스 단일'·'관리자 존재'·'라이브 없음' 같은 불변식으로 스코프해 검증한다.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("seed — 깨끗한 시작 상태", () => {
  it("단일 워크스페이스 (ADR-007)", async () => {
    expect(await prisma.workspace.count()).toBe(1);
  });

  it("워크스페이스 소유자(관리자)가 존재한다", async () => {
    const admin = await prisma.member.findUnique({
      where: { email: "de8167@gmail.com" },
    });
    expect(admin?.name).toBe("조성민");
    expect(admin?.role).toBe("관리자");
  });

  it("active LiveSession을 시드하지 않음 (ADR-001 — 기본 라이브 없음)", async () => {
    expect(await prisma.liveSession.count({ where: { active: true } })).toBe(0);
  });
});

describe("seed — 멀티팀 이관 (ADR-018)", () => {
  it("하박조팽 워크스페이스가 Team 1개로 이관됐다", async () => {
    const team = await prisma.team.findUnique({ where: { slug: "habakjopaeng" } });
    expect(team?.name).toBe("하박조팽");
  });

  it("이관된 팀에 owner Membership이 존재한다 (팀당 owner ≥ 1)", async () => {
    const team = await prisma.team.findUnique({ where: { slug: "habakjopaeng" } });
    const owners = await prisma.membership.count({
      where: { teamId: team!.id, role: "owner" },
    });
    expect(owners).toBeGreaterThanOrEqual(1);
  });

  it("owner는 기존 관리자(조성민/jo)다", async () => {
    const team = await prisma.team.findUnique({ where: { slug: "habakjopaeng" } });
    const owner = await prisma.membership.findFirst({
      where: { teamId: team!.id, role: "owner" },
    });
    expect(owner?.memberId).toBe("jo");
  });
});
