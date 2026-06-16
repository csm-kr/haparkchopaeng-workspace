import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";

// POST /api/papers/:id/reanalyze — 분석 재시도(실패/대기 시). step9의 "다시 분석" 버튼이 호출한다.
// CRITICAL: 활성 팀으로 스코핑(R37/ADR-020) — 다른 팀 논문은 404(교차 팀 변이 차단, R19).
// CRITICAL: 분석은 인라인이 아니라 Inngest 잡으로(R31/ADR-013→016) — 여기선 상태만 pending으로 되돌리고 이벤트만 보낸다.

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // 활성 팀의 논문만 — 다른 팀 id면 null → 404(존재를 드러내지 않는다, R19).
    const team = await getActiveTeam(session.memberId);
    const paper = team
      ? await prisma.paper.findFirst({ where: { id, teamId: team.id }, select: { id: true } })
      : null;
    if (!paper) return fail(404, "NOT_FOUND", "논문을 찾을 수 없어요.");

    await prisma.paper.update({
      where: { id },
      data: { analysisStatus: "pending", analysisStartedAt: new Date() },
    });

    // 이벤트 전송 실패가 응답을 막지 않게 삼킨다(업로드≠분석, R28). 다시 호출로 재시도 가능.
    try {
      await inngest.send({ name: "paper/analyze", data: { paperId: id } });
    } catch (e) {
      console.error("paper/analyze 이벤트 전송 실패", e);
    }

    return ok({ id, analysisStatus: "pending" });
  } catch (e) {
    return toErrorResponse(e);
  }
}
