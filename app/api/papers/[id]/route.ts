import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { removeObject } from "@/lib/storage";

// DELETE /api/papers/:id — 논문 삭제. ✍️ 올린 사람 또는 관리자만(SECURITY).
// CRITICAL: 권한은 세션에서 — 클라가 보낸 식별자 미신뢰(R3).
// 분석·figure·섹션 노트는 스키마 onDelete:Cascade로 함께 지워진다. 원문 PDF는 best-effort 정리.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const paper = await prisma.paper.findUnique({ where: { id } });
    if (!paper) return fail(404, "NOT_FOUND", "논문을 찾을 수 없어요.");

    // 올린 사람만 삭제할 수 있다(R3). 그 외(관리자 포함) 403.
    if (paper.uploadedBy !== session.memberId) {
      return fail(403, "FORBIDDEN", "올린 사람만 삭제할 수 있어요.");
    }

    await prisma.paper.delete({ where: { id } }); // cascade: 분석/figure/노트
    await removeObject(paper.pdfUrl); // 원문 PDF 정리(실패해도 무시)

    return ok({ id });
  } catch (e) {
    return toErrorResponse(e);
  }
}
