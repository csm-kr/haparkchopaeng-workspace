import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { getActiveSession } from "@/lib/live";

// GET /api/live — 활성 팀의 현재 active 세션(없으면 null). 🔒
// CRITICAL: 활성 팀으로 스코핑(R37/ADR-020) — 팀이 없으면 라이브도 없다(null).
// CRITICAL: 자격증명(streamKey 등)은 포함하지 않는다 — 세션 메타와 참가자만(SECURITY/R36).
export async function GET(req: Request): Promise<Response> {
  try {
    const auth = await requireAuth();
    const team = await getActiveTeam(auth.memberId);
    const expectedTeamId = req.headers.get("X-Hapark-Team-Id");
    if (expectedTeamId && expectedTeamId !== team?.id) {
      return fail(409, "CONFLICT", "활성 팀이 바뀌었어요. 페이지를 새로고침해주세요.");
    }
    if (!team) return ok(null);
    const session = await getActiveSession(team.id);
    return ok(session ?? null);
  } catch (e) {
    return toErrorResponse(e);
  }
}
