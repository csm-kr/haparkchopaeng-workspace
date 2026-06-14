import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// DELETE /api/presentations/:id — 발표 자료 삭제. ✍️ 발표자 또는 관리자만(SECURITY).
// CRITICAL: 권한은 세션에서 — 클라가 보낸 식별자 미신뢰(R3).
// 에셋·버전·댓글(+반응)은 스키마 onDelete:Cascade로 함께 지워진다.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const pres = await prisma.presentation.findUnique({ where: { id } });
    if (!pres) return fail(404, "NOT_FOUND", "발표 자료를 찾을 수 없어요.");

    // 발표자(작성자)만 삭제할 수 있다(R3). 그 외(관리자 포함) 403.
    if (pres.presenterId !== session.memberId) {
      return fail(403, "FORBIDDEN", "발표자만 삭제할 수 있어요.");
    }

    await prisma.presentation.delete({ where: { id } }); // cascade: 에셋/버전/댓글

    return ok({ id });
  } catch (e) {
    return toErrorResponse(e);
  }
}
