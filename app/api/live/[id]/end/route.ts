import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { deleteRoom } from "@/lib/livekit";
import { broadcastLive } from "@/lib/realtime";

// POST /api/live/:id/end — 세션 전체 종료. ✍️ 발표자 본인 또는 관리자(👑)만.
// CRITICAL: /end만 전역 종료(active=false) — /leave는 본인만(ADR-001/R6).
// CRITICAL: 권한은 진입부에서(R19). presenterId·role은 세션/DB에서, 클라 입력 미신뢰(R3).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const live = await prisma.liveSession.findUnique({
      where: { id },
      select: { id: true, presenterId: true },
    });
    if (!live) return fail(404, "NOT_FOUND", "진행 중인 라이브가 없어요.");

    const isPresenter = live.presenterId === session.memberId;
    const isAdmin = session.role === "관리자";
    if (!isPresenter && !isAdmin) {
      return fail(403, "FORBIDDEN", "라이브는 발표자나 관리자만 종료할 수 있어요.");
    }

    // LiveKit 룸 정리(best-effort, 실패 무시 — 세션은 곧 DB에서 비활성).
    await deleteRoom(id);
    await prisma.liveSession.update({
      where: { id },
      data: { active: false, endedAt: new Date() },
    });

    // 전역 종료를 모든 구독 클라에 푸시(폴링 아님, R33). 실패는 무시(graceful).
    await broadcastLive("live.ended", { sessionId: id });

    return ok({});
  } catch (e) {
    return toErrorResponse(e);
  }
}
