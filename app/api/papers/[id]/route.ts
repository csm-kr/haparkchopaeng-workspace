import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { removeObject, removeFolder } from "@/lib/storage";

// DELETE /api/papers/:id — 논문 삭제. ✍️ 올린 사람만(SECURITY).
// CRITICAL: 활성 팀으로 스코핑(R37/ADR-020) — 다른 팀 논문은 404(교차 팀 변이 차단, R19).
// CRITICAL: 권한은 세션에서 — 클라가 보낸 식별자 미신뢰(R3).
// 분석·figure·섹션 노트는 스키마 onDelete:Cascade로 함께 지워진다. 원문 PDF는 best-effort 정리.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // 활성 팀의 논문만 — 다른 팀 id면 findFirst가 null → 404(존재를 드러내지 않는다, R19).
    const team = await getActiveTeam(session.memberId);
    const paper = team
      ? await prisma.paper.findFirst({ where: { id, teamId: team.id } })
      : null;
    if (!paper) return fail(404, "NOT_FOUND", "논문을 찾을 수 없어요.");

    // 올린 사람만 삭제할 수 있다(R3). 그 외(관리자 포함) 403.
    if (paper.uploadedBy !== session.memberId) {
      return fail(403, "FORBIDDEN", "올린 사람만 삭제할 수 있어요.");
    }

    await prisma.paper.delete({ where: { id } }); // cascade: 분석/figure/노트
    await removeObject(paper.pdfUrl); // 원문 PDF 정리(실패해도 무시)
    await removeFolder(`figures/${id}`); // figure 이미지 정리(best-effort)

    return ok({ id });
  } catch (e) {
    return toErrorResponse(e);
  }
}
