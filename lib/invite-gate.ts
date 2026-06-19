import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { pickMemberColor } from "@/lib/member-color";

// 신원(IdP)으로 검증된 이메일을 앱 Member로 해소한다 (서버 전용).
// 멀티팀 전환(ADR-018): 합류 게이트는 "로그인 시점 이메일 매칭"에서 "팀 합류 시점 토큰 검증"으로 이동했다.
// 로그인은 누구나 — 거부 게이트(gateInvitedEmail)는 제거됐다. /auth/callback이 findOrCreateMember를 쓴다.

export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * 인증된 이메일을 앱 Member로 해소한다 — 거부 없음(멀티팀: 로그인은 누구나, ADR-018).
 * 있으면 반환, 없으면 생성(이름=local-part, 기본 역할 "멤버"). 합류 게이트는 팀 합류(초대 토큰)로 이동.
 * (step 3에서 /auth/callback이 gateInvitedEmail 대신 이걸 쓴다.)
 */
export async function findOrCreateMember(email: string): Promise<Member> {
  const existing = await prisma.member.findUnique({ where: { email } });
  if (existing) return existing;

  const local = email.split("@")[0] || "member";
  return prisma.member.create({
    data: {
      id: crypto.randomUUID(),
      name: local,
      handle: `@${local}-${Date.now().toString(36)}`,
      email,
      role: "멤버", // 기본 역할 — 팀 합류 시 멤버십 역할로 별도 부여(ADR-018)
      color: pickMemberColor(email), // 팔레트에서 결정적 분배(모두 동일색 방지)
      initial: local.slice(0, 1).toUpperCase(),
    },
  });
}
