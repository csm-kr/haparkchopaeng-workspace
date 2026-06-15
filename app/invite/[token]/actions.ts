"use server";

import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { acceptInvite } from "@/lib/invite";

// 초대 수락 Server Action (쓰기 = Server Action, ADR-015/R32).
// CRITICAL: memberId는 클라 입력이 아니라 세션에서 취한다(R3). 합류는 acceptInvite(트랜잭션)만 경유.
// 실패 코드(not_found|revoked|expired|used_up)는 판별 유니온으로 돌려 페이지가 사람말로 보인다(R30).

export type AcceptInviteResult =
  | { ok: true; teamSlug: string }
  | { ok: false; code: string; message: string };

export async function acceptInviteAction(token: string): Promise<AcceptInviteResult> {
  let session;
  try {
    session = await requireAuth();
  } catch {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요해요." };
  }

  try {
    const { teamSlug } = await acceptInvite({ token, memberId: session.memberId });
    return { ok: true, teamSlug };
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}
