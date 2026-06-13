import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/cloudflare";

// POST /api/webhooks/cloudflare — Stream Live 이벤트(녹화 완료 등) 수신(S4.6).
// CRITICAL: 세션 인증이 아니라 서명 검증으로 보호한다(R36/SECURITY). 검증 실패 시 401.
export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("webhook-signature");
    if (!verifyWebhookSignature(rawBody, signature)) {
      return fail(401, "UNAUTHORIZED", "서명을 확인할 수 없어요.");
    }

    // 녹화 완료 페이로드: liveInput(Live Input UID)으로 세션을 매칭해 recordingUrl 기록.
    const payload = JSON.parse(rawBody) as {
      liveInput?: string;
      readyToStream?: boolean;
      playback?: { hls?: string };
    };
    const liveInputId = payload.liveInput;
    const recordingUrl = payload.playback?.hls;
    if (liveInputId && recordingUrl) {
      await prisma.liveSession.updateMany({
        where: { cloudflareLiveInputId: liveInputId },
        data: { recordingUrl },
      });
    }

    return ok({});
  } catch (e) {
    return toErrorResponse(e);
  }
}
