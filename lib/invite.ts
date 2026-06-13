import { signPayload, verifyPayload } from "@/lib/sign";
import type { Role } from "@/types";

// 초대 토큰 플럼빙 (서버 전용). 합류는 이 토큰 검증으로만 — 공개 가입 없음(ADR-007/R18).
// INVITE_TOKEN_SECRET으로 서명, 만료 포함. 1회성은 Invite.status(accepted/revoked)로 핸들러가 강제한다.

const INVITE_TTL_SEC = 60 * 60 * 24 * 7; // 7일

export interface InvitePayload {
  email: string;
  role: Role;
  /** Invite.id — 합류 시 해당 초대를 accepted로 소비 */
  inviteId: string;
}

function inviteSecret(): string {
  const secret = process.env.INVITE_TOKEN_SECRET;
  if (!secret) throw new Error("INVITE_TOKEN_SECRET is not set");
  return secret;
}

/** 초대 토큰 발급. 만료 포함. */
export function signInvite(payload: InvitePayload): string {
  return signPayload({ ...payload }, inviteSecret(), { expiresInSec: INVITE_TTL_SEC });
}

/** 초대 수락 링크. APP_BASE_URL은 서버에서만 읽는다. */
export function inviteLink(token: string): string {
  const base = process.env.APP_BASE_URL ?? "";
  return `${base}/invite/accept?token=${encodeURIComponent(token)}`;
}

/** 초대 토큰 검증. 위조·변조·만료·형식 오류는 모두 null. */
export function verifyInvite(token: string): InvitePayload | null {
  const payload = verifyPayload<Partial<InvitePayload>>(token, inviteSecret());
  if (!payload) return null;
  if (
    typeof payload.email !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.inviteId !== "string"
  ) {
    return null;
  }
  return { email: payload.email, role: payload.role, inviteId: payload.inviteId };
}
