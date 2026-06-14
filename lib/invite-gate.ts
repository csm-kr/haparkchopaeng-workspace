import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

// 신원(IdP)으로 검증된 이메일을 앱 Member로 해소한다 (서버 전용).
// 멀티팀 전환(ADR-018): 합류 게이트는 "로그인 시점 이메일 매칭"에서 "팀 합류 시점 토큰 검증"으로 이동했다.
// gateInvitedEmail은 step 3에서 findOrCreateMember로 교체될 때까지 /auth/callback이 쓴다(여기선 유지만).

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
      color: "var(--m-jo)",
      initial: local.slice(0, 1).toUpperCase(),
    },
  });
}

/**
 * (레거시) 이미 합류한 Member면 통과, 아니면 NOT_INVITED.
 * ADR-018로 이메일 매칭 초대 경로는 폐기됐다 — 합류는 토큰(acceptInvite)으로만. step 3에서 제거 예정.
 */
export async function gateInvitedEmail(email: string): Promise<GateResult> {
  const existing = await prisma.member.findUnique({ where: { email } });
  if (existing) return { ok: true, member: existing };
  return { ok: false, reason: "NOT_INVITED" };
}
