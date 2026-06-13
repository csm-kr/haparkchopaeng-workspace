import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";

// POST /api/papers/:id/reanalyze — 분석 재시도(실패/대기 시). step9의 "다시 분석" 버튼이 호출한다.
// CRITICAL: 분석은 인라인이 아니라 Inngest 잡으로(R31/ADR-013→016) — 여기선 상태만 pending으로 되돌리고 이벤트만 보낸다.

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireAuth();
    const { id } = await params;

    const paper = await prisma.paper.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!paper) return fail(404, "NOT_FOUND", "논문을 찾을 수 없어요.");

    await prisma.paper.update({
      where: { id },
      data: { analysisStatus: "pending" },
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
