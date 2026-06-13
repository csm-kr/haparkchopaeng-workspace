import { requireAuth } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/http";
import { getActiveSession } from "@/lib/live";

// GET /api/live — 현재 active 세션(없으면 null). 🔒
// CRITICAL: 자격증명(streamKey 등)은 포함하지 않는다 — 세션 메타와 참가자만(SECURITY/R36).
export async function GET(): Promise<Response> {
  try {
    await requireAuth();
    const session = await getActiveSession();
    return ok(session ?? null);
  } catch (e) {
    return toErrorResponse(e);
  }
}
