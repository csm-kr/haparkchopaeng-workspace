import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createLiveInput } from "@/lib/cloudflare";
import { getActiveSession } from "@/lib/live";

// POST /api/live/start — 라이브 시작(발표자). 🔒
// CRITICAL: 동시 active 세션은 1개 — 이미 있으면 409(ADR-001/R1·R6).
// CRITICAL: presenterId는 세션에서 취한다 — 클라 입력 미신뢰(R3).
// CRITICAL: Stream Key(rtmps.streamKey/srt.passphrase)는 발표자=호출자에게만(SECURITY/R7·R36).
export async function POST(): Promise<Response> {
  try {
    const session = await requireAuth();

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

    // TODO(step1): Supabase Realtime 채널에 live.started broadcast — 이 step 범위 아님.

    return ok(
      {
        session: {
          id: live.id,
          presenterId: live.presenterId,
          startedAt: live.startedAt,
        },
        rtmps: input.rtmps,
        srt: input.srt,
        playback: input.playback,
      },
      201,
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
