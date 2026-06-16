import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isLiveConfigured, issueAccessToken, livekitUrl } from "@/lib/livekit";
import { getActiveSession } from "@/lib/live";
import { broadcastLive } from "@/lib/realtime";
import type { LiveStartResponse } from "@/types";

// POST /api/live/start — 라이브 시작(발표자). 🔒
// CRITICAL: 동시 active 세션은 팀당 1개 — 이미 있으면 409(ADR-001/R6, 팀당은 ADR-020).
// CRITICAL: teamId는 활성 팀에서, presenterId·토큰 identity는 세션에서 취한다 — 클라 입력 미신뢰(R3).
// CRITICAL: 발표자 토큰에만 화면공유 grant — 토큰은 본인에게만 응답(SECURITY/R7).
export async function POST(): Promise<Response> {
  try {
    const session = await requireAuth();

    // LiveKit 설정 전이면 친절히 안내 — 정체불명 500 대신 503(R30).
    if (!isLiveConfigured()) {
      return fail(
        503,
        "LIVE_UNCONFIGURED",
        "모두의 세미나가 아직 연결되지 않았어요. 관리자가 LiveKit 설정을 마치면 켜져요.",
      );
    }

    // 활성 팀(검증된 멤버십)에서 teamId를 취한다 — 클라 입력 미신뢰(R3/R19). 없으면 403.
    const team = await getActiveTeam(session.memberId);
    if (!team) return fail(403, "FORBIDDEN", "활성 팀이 없어요.");

    // 팀당 1개 강제: 활성 팀에 이미 active 세션이 있으면 시작하지 않는다(입장 안내는 UI에서, 409).
    const existing = await getActiveSession(team.id);
    if (existing) {
      return fail(409, "CONFLICT", "이미 라이브가 진행 중이에요.");
    }

    // 미사용 레거시 cloudflareLiveInputId는 설정하지 않는다 — 룸은 id에서 파생(ADR-019).
    const live = await prisma.liveSession.create({
      data: {
        active: true,
        teamId: team.id, // R3/R37: 활성 팀에서 주입
        presenterId: session.memberId, // R3: 세션에서 주입
      },
    });

    // 발표자 토큰: 화면공유 grant 포함. identity는 세션에서(R3).
    const token = await issueAccessToken({
      sessionId: live.id,
      identity: session.memberId,
      canPublishScreen: true,
    });

    // 전이를 모든 구독 클라에 푸시(폴링 아님, R33). 실패는 무시(graceful) — 전파는 best-effort.
    await broadcastLive("live.started", { sessionId: live.id });

    return ok<LiveStartResponse>(
      {
        session: {
          id: live.id,
          presenterId: live.presenterId,
          startedAt: live.startedAt.toISOString(),
        },
        token,
        url: livekitUrl(),
      },
      201,
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
