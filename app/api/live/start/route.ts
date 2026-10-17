import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { isLiveConfigured, issueAccessToken, livekitUrl } from "@/lib/livekit";
import { createLiveSession } from "@/lib/live";
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

    // DB 직렬화 트랜잭션으로 동시 요청도 팀당 1개만 생성한다.
    const live = await createLiveSession(team.id, session.memberId);

    // 발표자 토큰: 화면공유 grant 포함. identity는 세션에서(R3).
    const token = await issueAccessToken({
      sessionId: live.id,
      identity: session.memberId,
      canPublishScreen: true,
    });

    // 전이를 모든 구독 클라에 푸시(폴링 아님, R33). 실패는 무시(graceful) — 전파는 best-effort.
    await broadcastLive("live.started", { teamId: team.id, sessionId: live.id });

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
