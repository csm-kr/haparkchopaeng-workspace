import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { inviteLink } from "@/lib/invite";
import { isTeamAdmin } from "@/lib/teams";
import { prisma } from "@/lib/prisma";

// POST /api/invites/:id/resend — 활성 초대의 링크를 다시 노출한다(owner·admin만, R19).
// 단순화(ADR-018): 새 토큰 발급 없이 기존 활성 초대의 링크를 돌려준다. 비활성(회수/만료/소진)이면 404.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const invite = await prisma.invite.findUnique({ where: { id } });
    if (!invite) return fail(404, "NOT_FOUND", "초대를 찾을 수 없어요.");

    if (!(await isTeamAdmin(invite.teamId, session.memberId))) {
      return fail(403, "FORBIDDEN", "초대 재전송은 owner·admin만 할 수 있어요.");
    }

    const isActive =
      invite.revokedAt === null &&
      invite.expiresAt.getTime() > Date.now() &&
      invite.usedCount < invite.maxUses;
    if (!isActive) return fail(404, "NOT_FOUND", "더 이상 유효하지 않은 초대예요.");

    return ok({ invite, link: inviteLink(invite.token) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
