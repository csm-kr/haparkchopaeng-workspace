import { requireAuth } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// POST /api/live/:id/leave — 본인 퇴장. 🔒
// CRITICAL: 본인 Participant만 닫는다(leftAt=now). 세션은 active 유지 — 전역 종료 아님(ADR-001).
//   전역 종료는 /end만 한다(R6).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

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
