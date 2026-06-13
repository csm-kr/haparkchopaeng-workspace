import { requireRole } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// DELETE /api/invites/:id — 초대 취소(👑 관리자 전용). status=revoked로 소비(되돌리기 토스트는 UI에서).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireRole("관리자");
    const { id } = await params;

    const invite = await prisma.invite.findUnique({ where: { id } });
    if (!invite) return fail(404, "NOT_FOUND", "초대를 찾을 수 없어요.");

    const updated = await prisma.invite.update({
      where: { id },
      data: { status: "revoked" },
    });
    return ok(updated);
  } catch (e) {
    return toErrorResponse(e);
  }
}
