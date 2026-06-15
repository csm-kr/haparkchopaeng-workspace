import { prisma } from "@/lib/prisma";

/**
 * teamId가 비어 있는("") 기존 행을 부트스트랩 팀(가장 먼저 생성된 Team = seed 이관 '하박조팽')으로
 * 채운다. 멱등 — 두 번 돌려도 안전하다(이미 채워진 행은 재변경 없음).
 *
 * - 부트스트랩 팀 = createdAt 최소. 팀이 0개면 아무것도 안 한다(안전, no-op).
 * - "" 행만 대상으로 한다 — 이미 다른 팀에 속한 행은 건드리지 않는다(다른 팀에 새지 않게).
 *
 * CRITICAL: 운영 DB를 직접 건드리지 않는다 — 이 함수는 step 5의 수동 절차/시드에서 호출된다.
 *           헤드리스 자율 실행 금지(ADR-020).
 */
export async function backfillTeamScoping(): Promise<{
  team: string;
  updated: Record<string, number>;
}> {
  const team = await prisma.team.findFirst({ orderBy: { createdAt: "asc" } });
  if (!team) return { team: "", updated: {} };

  const where = { teamId: "" };
  const data = { teamId: team.id };
  const updated: Record<string, number> = {
    Paper: (await prisma.paper.updateMany({ where, data })).count,
    Presentation: (await prisma.presentation.updateMany({ where, data })).count,
    ScheduleMonth: (await prisma.scheduleMonth.updateMany({ where, data })).count,
    FineConfig: (await prisma.fineConfig.updateMany({ where, data })).count,
    MemberLedger: (await prisma.memberLedger.updateMany({ where, data })).count,
    LiveSession: (await prisma.liveSession.updateMany({ where, data })).count,
  };
  return { team: team.id, updated };
}
