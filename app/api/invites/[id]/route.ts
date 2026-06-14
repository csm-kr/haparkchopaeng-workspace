import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { isTeamAdmin } from "@/lib/teams";
import { prisma } from "@/lib/prisma";

// DELETE /api/invites/:id — 초대 회수(revokedAt=now). owner·admin만(R19).
// 회수된 토큰은 acceptInvite에서 revoked로 거부된다(베어러 자격증명 무효화).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const invite = await prisma.invite.findUnique({ where: { id } });
    if (!invite) return fail(404, "NOT_FOUND", "초대를 찾을 수 없어요.");

    if (!(await isTeamAdmin(invite.teamId, session.memberId))) {
      return fail(403, "FORBIDDEN", "초대 회수는 owner·admin만 할 수 있어요.");
    }

    const updated = await prisma.invite.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return ok(updated);
  } catch (e) {
    return toErrorResponse(e);
  }
}
