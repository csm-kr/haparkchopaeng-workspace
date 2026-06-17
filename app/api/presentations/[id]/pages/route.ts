import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { getTeamPresentationPdfPath } from "@/lib/presentations";
import { countPdfPages } from "@/lib/pdf-page-render";
import { downloadObject } from "@/lib/storage";

// GET /api/presentations/:id/pages — 발표자료 PDF 페이지 수. 라이브 공유 시작 시 발표자가 조회.
// CRITICAL: 세션 + 활성 팀 스코프(R37) — 다른 팀 자료/PDF 없음은 404(존재 숨김, R19).

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const team = await getActiveTeam(session.memberId);
    const path = team ? await getTeamPresentationPdfPath(id, team.id) : null;
    if (!path) return fail(404, "NOT_FOUND", "공유할 수 있는 PDF 자료가 없어요.");

    const pdf = await downloadObject(path);
    return ok({ count: countPdfPages(pdf) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
