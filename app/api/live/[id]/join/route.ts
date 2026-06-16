import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isLiveConfigured, issueAccessToken, livekitUrl } from "@/lib/livekit";
import type { LiveJoinResponse } from "@/types";

// POST /api/live/:id/join — 시청자 참가 등록 + LiveKit 토큰. 🔒
// CRITICAL: 세션이 내 활성 팀(=멤버십) 것일 때만 — 교차 팀 라이브는 차단(R19/ADR-020).
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
        "모두의 세미나가 아직 연결되지 않았어요. 관리자가 LiveKit 설정을 마치면 켜져요.",
      );
    }

    const team = await getActiveTeam(session.memberId);

    const live = await prisma.liveSession.findUnique({
      where: { id },
      select: { id: true, active: true, teamId: true },
    });
    // 비active·없음·교차 팀이면 404(다른 팀 세션 존재를 드러내지 않는다, R19).
    if (!live || !live.active || !team || live.teamId !== team.id) {
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
