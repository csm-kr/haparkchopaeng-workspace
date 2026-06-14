import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createLiveInput, isLiveConfigured } from "@/lib/cloudflare";
import { getActiveSession } from "@/lib/live";
import { broadcastLive } from "@/lib/realtime";

// POST /api/live/start — 라이브 시작(발표자). 🔒
// CRITICAL: 동시 active 세션은 1개 — 이미 있으면 409(ADR-001/R1·R6).
// CRITICAL: presenterId는 세션에서 취한다 — 클라 입력 미신뢰(R3).
// CRITICAL: 송출 자격증명(rtmps.streamKey/srt.passphrase/webRTC.url)은 발표자=호출자에게만(SECURITY/R7·R36).
export async function POST(): Promise<Response> {
  try {
    const session = await requireAuth();

    // 송출(Cloudflare) 설정 전이면 친절히 안내 — 정체불명 500 대신 503(R30).
    if (!isLiveConfigured()) {
      return fail(
        503,
        "LIVE_UNCONFIGURED",
        "세미나 라이브(송출)가 아직 연결되지 않았어요. 관리자가 Cloudflare 설정을 마치면 켜져요.",
      );
    }

    // 동시 1개 강제: 이미 active 세션이 있으면 시작하지 않는다(입장 안내는 UI에서, 409).
    const existing = await getActiveSession();
    if (existing) {
      return fail(409, "CONFLICT", "이미 라이브가 진행 중이에요.");
    }

    const input = await createLiveInput();
    const live = await prisma.liveSession.create({
      data: {
        active: true,
        presenterId: session.memberId, // R3: 세션에서 주입
        cloudflareLiveInputId: input.liveInputId,
      },
    });

    // 전이를 모든 구독 클라에 푸시(폴링 아님, R33). 실패는 무시(graceful) — 전파는 best-effort.
    await broadcastLive("live.started", { sessionId: live.id });

    return ok(
      {
        session: {
          id: live.id,
          presenterId: live.presenterId,
          startedAt: live.startedAt,
        },
        rtmps: input.rtmps,
        srt: input.srt,
        webRTC: input.webRTC,
        playback: input.playback,
      },
      201,
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
