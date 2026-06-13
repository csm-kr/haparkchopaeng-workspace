import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getLiveInputPlayback } from "@/lib/cloudflare";

// POST /api/live/:id/join — 시청자 참가 등록 + 재생 정보. 🔒
// CRITICAL: 응답은 재생용 HLS만 — 송출 자격증명(streamKey/passphrase) 절대 미포함(R36/SECURITY).
// CRITICAL: participant memberId는 세션에서 취한다(R3). 재참가 허용(leftAt=null).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const live = await prisma.liveSession.findUnique({
      where: { id },
      select: { id: true, active: true, cloudflareLiveInputId: true },
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

    // 시청자에게는 재생용 HLS만. 송출 자격증명은 발표자 /start에만 있었다(R36).
    const playback = live.cloudflareLiveInputId
      ? await getLiveInputPlayback(live.cloudflareLiveInputId)
      : { hls: "" };

    return ok({ playback });
  } catch (e) {
    return toErrorResponse(e);
  }
}
