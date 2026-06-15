import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isLiveConfigured, issueAccessToken, livekitUrl } from "@/lib/livekit";
import type { LiveJoinResponse } from "@/types";

// POST /api/live/:id/join — 시청자 참가 등록 + LiveKit 토큰. 🔒
// CRITICAL: 참가자 토큰엔 화면공유 grant 없음 — 화면공유는 발표자만(R7).
// CRITICAL: 토큰 identity는 세션에서 취한다(R3). 재참가 허용(leftAt=null, 감사용).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    if (!isLiveConfigured()) {
      return fail(
        503,
        "LIVE_UNCONFIGURED",
        "세미나 라이브가 아직 연결되지 않았어요. 관리자가 LiveKit 설정을 마치면 켜져요.",
      );
    }

    const live = await prisma.liveSession.findUnique({
      where: { id },
      select: { id: true, active: true },
    });
    if (!live || !live.active) {
      return fail(404, "NOT_FOUND", "진행 중인 라이브가 없어요.");
    }

    await prisma.participant.upsert({
      where: {
        liveSessionId_memberId: { liveSessionId: id, memberId: session.memberId },
      },
      create: { liveSessionId: id, memberId: session.memberId, leftAt: null },
      update: { leftAt: null }, // 재참가
    });

    // 참가자 토큰: 화면공유 grant 없음(R7). identity는 세션에서(R3).
    const token = await issueAccessToken({
      sessionId: id,
      identity: session.memberId,
      canPublishScreen: false,
    });

    return ok<LiveJoinResponse>({ token, url: livekitUrl() });
  } catch (e) {
    return toErrorResponse(e);
  }
}
