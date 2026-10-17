import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";

/** 조회와 생성을 직렬화한다. 다른 요청이 먼저 커밋하면 재조회 후 409로 안내한다. */
export async function createLiveSession(teamId: string, presenterId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.liveSession.findFirst({
          where: { teamId, active: true }, select: { id: true },
        });
        if (existing) throw new HttpError(409, "CONFLICT", "이미 라이브가 진행 중이에요.");
        return tx.liveSession.create({ data: { teamId, presenterId, active: true } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") {
        throw error;
      }
    }
  }
  throw new HttpError(409, "CONFLICT", "라이브 상태가 바뀌었어요. 다시 시도해주세요.");
}

// 라이브 데이터 접근(서버 전용). 읽기는 RSC/route handler에서 Prisma 직접 조회(ADR-015).
// CRITICAL: 동시 active 세션은 팀당 최대 1개 — 앱 전역 live와 1:1(ADR-001/R6, 팀당은 ADR-020).
// CRITICAL: 여기서 LiveKit을 호출하지 않는다 — 라우트가 데이터+LiveKit 토큰을 조합한다(ADR-019).
// CRITICAL: 자격증명(LiveKit 토큰 등)은 포함하지 않는다 — DB의 cloudflareLiveInputId는 미사용 레거시 컬럼.

export interface ActiveSession {
  id: string;
  presenterId: string;
  startedAt: Date;
  participants: { memberId: string; joinedAt: Date; leftAt: Date | null }[];
}

/**
 * 활성 팀의 현재 active 세션(없으면 null). active 세션은 팀당 최대 1개다(ADR-020).
 * CRITICAL: where에 teamId를 넣어 스코핑한다(R37) — 다른 팀의 라이브가 섞이지 않는다.
 */
export async function getActiveSession(
  teamId: string,
): Promise<ActiveSession | null> {
  return prisma.liveSession.findFirst({
    where: { active: true, teamId },
    select: {
      id: true,
      presenterId: true,
      startedAt: true,
      participants: {
        select: { memberId: true, joinedAt: true, leftAt: true },
      },
    },
  });
}
