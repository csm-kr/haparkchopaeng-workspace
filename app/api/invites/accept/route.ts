import crypto from "node:crypto";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { verifyInvite } from "@/lib/invite";
import { prisma } from "@/lib/prisma";

// POST /api/invites/accept — 토큰 검증 → Member 생성 + Invite.status=accepted + 세션 발급.
// CRITICAL: 토큰 없이는 합류 불가. 공개 가입 경로가 아니다(ADR-007/R18).

const AcceptInput = z.object({ token: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  try {
    const body: unknown = await req.json().catch(() => null);
    const parsed = AcceptInput.safeParse(body);
    if (!parsed.success) return fail(400, "BAD_REQUEST", "초대 토큰이 필요해요.");

    const payload = verifyInvite(parsed.data.token);
    if (!payload) return fail(401, "UNAUTHORIZED", "초대 링크가 만료되었거나 올바르지 않아요.");

    const invite = await prisma.invite.findUnique({ where: { id: payload.inviteId } });
    // 1회성: 이미 수락/취소된 초대는 재사용 불가.
    if (!invite || invite.status !== "pending") {
      return fail(409, "CONFLICT", "이미 사용되었거나 취소된 초대예요.");
    }

    const existing = await prisma.member.findUnique({ where: { email: payload.email } });
    if (existing) return fail(409, "CONFLICT", "이미 합류한 멤버예요.");

    // 멤버 생성 + 초대 소비를 한 트랜잭션으로(부분 실패 방지).
    const local = payload.email.split("@")[0] || "member";
    const member = await prisma.$transaction(async (tx) => {
      const created = await tx.member.create({
        data: {
          id: crypto.randomUUID(),
          name: local,
          handle: `@${local}-${Date.now().toString(36)}`,
          email: payload.email,
          role: payload.role, // 역할은 토큰(서버 서명)에서 — 클라 입력 미신뢰(R3)
          color: "var(--m-jo)",
          initial: local.slice(0, 1).toUpperCase(),
        },
      });
      await tx.invite.update({ where: { id: invite.id }, data: { status: "accepted" } });
      return created;
    });

    await createSession(member.id);
    return ok(member, 201);
  } catch (e) {
    return toErrorResponse(e);
  }
}
