import { prisma } from "@/lib/prisma";

// 라이브 데이터 접근(서버 전용). 읽기는 RSC/route handler에서 Prisma 직접 조회(ADR-015).
// CRITICAL: 동시 active 세션은 최대 1개 — 앱 전역 live와 1:1(ADR-001/R1).
// CRITICAL: 여기서 LiveKit을 호출하지 않는다 — 라우트가 데이터+LiveKit 토큰을 조합한다(ADR-019).
// CRITICAL: 자격증명(LiveKit 토큰 등)은 포함하지 않는다 — DB의 cloudflareLiveInputId는 미사용 레거시 컬럼.

export interface ActiveSession {
  id: string;
  presenterId: string;
  startedAt: Date;
  participants: { memberId: string; joinedAt: Date; leftAt: Date | null }[];
}

/** 현재 active 세션(없으면 null). active 세션은 최대 1개다(ADR-001). */
export async function getActiveSession(): Promise<ActiveSession | null> {
  return prisma.liveSession.findFirst({
    where: { active: true },
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
