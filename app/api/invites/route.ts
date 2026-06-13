import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { inviteLink, signInvite } from "@/lib/invite";
import { prisma } from "@/lib/prisma";

// POST /api/invites — 초대 생성 + 토큰 링크. GET /api/invites — 대기 중인 초대 목록.
// CRITICAL: 둘 다 관리자 전용(👑). 권한 체크는 핸들러 진입부에서(R19, SECURITY 인가 표).

const CreateInvite = z.object({
  email: z.email(),
  role: z.enum(["관리자", "멤버", "게스트"]),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole("관리자");
    const body: unknown = await req.json().catch(() => null);
    const parsed = CreateInvite.safeParse(body);
    if (!parsed.success) return fail(400, "BAD_REQUEST", "이메일과 역할을 확인해주세요.");

    // 작성자(invitedBy)는 세션에서 취한다 — 클라 입력 미신뢰(R3).
    const invite = await prisma.invite.create({
      data: {
        email: parsed.data.email,
        role: parsed.data.role,
        invitedBy: session.memberId,
      },
    });

    const token = signInvite({
      email: invite.email,
      role: parsed.data.role,
      inviteId: invite.id,
    });
    return ok({ invite, link: inviteLink(token) }, 201);
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function GET(): Promise<Response> {
  try {
    await requireRole("관리자");
    const invites = await prisma.invite.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
    });
    return ok(invites);
  } catch (e) {
    return toErrorResponse(e);
  }
}
