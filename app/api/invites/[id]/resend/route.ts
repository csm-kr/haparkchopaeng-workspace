import { requireRole } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { inviteLink, signInvite } from "@/lib/invite";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/types";

// POST /api/invites/:id/resend — 대기 중인 초대의 토큰 링크 재발급(👑 관리자 전용).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireRole("관리자");
    const { id } = await params;

    const invite = await prisma.invite.findUnique({ where: { id } });
    if (!invite || invite.status !== "pending") {
      return fail(404, "NOT_FOUND", "초대를 찾을 수 없어요.");
    }

    const token = signInvite({
      email: invite.email,
      role: invite.role as Role,
      inviteId: invite.id,
    });
    return ok({ invite, link: inviteLink(token) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
