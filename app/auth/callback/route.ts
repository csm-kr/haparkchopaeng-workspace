import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { gateInvitedEmail } from "@/lib/invite-gate";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /auth/callback — Google OAuth 콜백.
// 1) code → Supabase 세션 교환으로 신원(이메일) 획득
// 2) 초대 게이트(ADR-017): 멤버이거나 유효 초대일 때만 통과, 아니면 signOut + 거부
// 3) 통과 시 lib/auth로 앱 권한 세션 발급 → 홈
// CRITICAL: 비초대 이메일에 세션/Member를 만들지 않는다(R18). 권한 세션은 lib/auth로 일원화.

function redirectTo(path: string): Response {
  const base = process.env.APP_BASE_URL ?? "";
  return NextResponse.redirect(`${base}${path}`);
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return redirectTo("/?error=oauth"); // 코드 없음 — 잘못된 콜백
  }

  const supabase = await createSupabaseServerClient();

  const { data: exchange, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  const email = exchange?.user?.email;
  if (exchangeError || !email) {
    return redirectTo("/?error=oauth");
  }

  const result = await gateInvitedEmail(email);
  if (!result.ok) {
    // 비초대: Supabase 신원도 파기하고 명확히 거부(합류 금지).
    await supabase.auth.signOut();
    return redirectTo("/?error=not-invited");
  }

  // 신원 검증 통과 → 앱 권한 세션 발급(memberId/role은 DB에서).
  await createSession(result.member.id);
  return redirectTo("/");
}
