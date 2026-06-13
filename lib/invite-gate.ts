import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/types";

// 초대 게이트 (서버 전용). 신원(IdP)으로 검증된 이메일을 앱 Member로 해소한다.
// CRITICAL: Google 인증 성공 ≠ 합류. 수락된 멤버이거나 유효한 초대일 때만 통과(ADR-007/017, R18).

export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

export type GateResult =
  | { ok: true; member: Member }
  | { ok: false; reason: "NOT_INVITED" };

/**
 * 인증된 이메일을 초대 게이트로 통과시킨다.
 * - 이미 합류한 Member → 통과
 * - pending Invite 존재 → Member 생성 + Invite.status=accepted (트랜잭션) → 통과
 * - 둘 다 없음 → 거부(NOT_INVITED). 호출부는 Supabase signOut + 에러 리디렉트.
 *
 * 비밀번호 컬럼을 두지 않는다 — OAuth가 인증 수단(ADR-017).
 */
export async function gateInvitedEmail(email: string): Promise<GateResult> {
  const existing = await prisma.member.findUnique({ where: { email } });
  if (existing) return { ok: true, member: existing };

  // pending 초대만 유효. 만료(토큰 TTL)는 토큰 검증과 별개로 status로 1회성 강제.
  const invite = await prisma.invite.findFirst({
    where: { email, status: "pending" },
  });
  if (!invite) return { ok: false, reason: "NOT_INVITED" };

  const local = email.split("@")[0] || "member";
  const member = await prisma.$transaction(async (tx) => {
    const created = await tx.member.create({
      data: {
        id: crypto.randomUUID(),
        name: local,
        handle: `@${local}-${Date.now().toString(36)}`,
        email,
        role: invite.role as Role, // 역할은 초대(서버 소유)에서 — 클라 입력 미신뢰(R3)
        color: "var(--m-jo)",
        initial: local.slice(0, 1).toUpperCase(),
      },
    });
    await tx.invite.update({ where: { id: invite.id }, data: { status: "accepted" } });
    return created;
  });

  return { ok: true, member };
}
