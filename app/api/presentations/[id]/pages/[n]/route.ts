import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, toErrorResponse } from "@/lib/http";
import { getTeamPresentationPdfPath } from "@/lib/presentations";
import { renderPdfPageToPng } from "@/lib/pdf-page-render";
import { downloadObject } from "@/lib/storage";

// GET /api/presentations/:id/pages/:n — 발표자료 PDF의 n번째 페이지 PNG(1-based). 라이브 무대에 <img>로.
// CRITICAL: 세션 + 활성 팀 스코프(R37) — 다른 팀 자료/PDF 없음은 404(존재 숨김, R19).
// 페이지는 사실상 불변이라 private 캐시로 재요청을 줄인다(인증 자료라 공유 캐시 금지, R36).

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; n: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id, n } = await params;

    const pageNum = Number.parseInt(n, 10);
    if (!Number.isFinite(pageNum) || pageNum < 1) {
      return fail(400, "BAD_REQUEST", "페이지 번호가 올바르지 않아요.");
    }

    const team = await getActiveTeam(session.memberId);
    const path = team ? await getTeamPresentationPdfPath(id, team.id) : null;
    if (!path) return fail(404, "NOT_FOUND", "공유할 수 있는 PDF 자료가 없어요.");

    const pdf = await downloadObject(path);
    const png = renderPdfPageToPng(pdf, pageNum - 1); // 1-based → 0-based(내부 클램프)

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
