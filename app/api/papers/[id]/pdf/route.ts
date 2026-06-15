import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { signedDownloadUrl } from "@/lib/storage";

// GET /api/papers/:id/pdf — 원문 PDF 다운로드.
// CRITICAL: 비공개 버킷 + 단기 서명 URL로 리디렉트(R36). 영구/공개 URL 노출 금지.
// CRITICAL: 활성 팀으로 스코핑(R37/R19) — 다른 팀 논문 PDF는 id를 알아도 404(존재 숨김).
// 분석 상태와 무관하게 동작한다(R28).

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const team = await getActiveTeam(session.memberId);
    if (!team) return fail(404, "NOT_FOUND", "논문을 찾을 수 없어요.");

    const paper = await prisma.paper.findFirst({
      where: { id, teamId: team.id },
      select: { pdfUrl: true },
    });
    if (!paper) return fail(404, "NOT_FOUND", "논문을 찾을 수 없어요.");

    const url = await signedDownloadUrl(paper.pdfUrl, 60);
    return Response.redirect(url, 302);
  } catch (e) {
    return toErrorResponse(e);
  }
}
