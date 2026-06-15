import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// POST /api/live/:id/leave — 본인 퇴장. 🔒
// CRITICAL: 세션이 내 활성 팀(=멤버십) 것일 때만 — 교차 팀 라이브는 차단(R19/ADR-020).
// CRITICAL: 본인 Participant만 닫는다(leftAt=now). 세션은 active 유지 — 전역 종료 아님(ADR-001).
//   전역 종료는 /end만 한다(R6).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const team = await getActiveTeam(session.memberId);
    const live = await prisma.liveSession.findUnique({
      where: { id },
      select: { teamId: true },
    });
    // 없음·교차 팀이면 404(다른 팀 세션 존재를 드러내지 않는다, R19).
    if (!live || !team || live.teamId !== team.id) {
      return fail(404, "NOT_FOUND", "진행 중인 라이브가 없어요.");
    }

    // 본인 것만 — memberId는 세션에서(R3). 참가 기록이 없으면 조용히 0건(updateMany).
    await prisma.participant.updateMany({
      where: { liveSessionId: id, memberId: session.memberId, leftAt: null },
      data: { leftAt: new Date() },
    });

    return ok({});
  } catch (e) {
    return toErrorResponse(e);
  }
}
