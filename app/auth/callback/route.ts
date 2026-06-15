import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { findOrCreateMember } from "@/lib/invite-gate";
import { sanitizeNext } from "@/lib/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /auth/callback — Google OAuth 콜백.
// 1) code → Supabase 세션 교환으로 신원(이메일) 획득
// 2) 멀티팀(ADR-018): 로그인은 누구나 — 거부하지 않는다. findOrCreateMember로 멤버 해소.
//    합류 게이트는 팀 합류(초대 토큰)에만 — 여기선 신원만 검증한다.
// 3) lib/auth로 앱 권한 세션 발급 → 복귀(next) 또는 대시보드.
// CRITICAL: next는 same-origin /path만(오픈 리다이렉트 차단, SECURITY). 권한 세션은 lib/auth로 일원화.

function redirectTo(path: string): Response {
  const base = process.env.APP_BASE_URL ?? "";
  return NextResponse.redirect(`${base}${path}`);
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  // 복귀 목적지(초대 링크 등) — 정제(same-origin path만). google route가 redirectTo에 실어 보낸다.
  const next = sanitizeNext(url.searchParams.get("next"));
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

  // 신원 → 멤버 해소(없으면 생성). 비초대 거부 없음(ADR-018). 권한 세션 발급(memberId/role은 DB에서, R3).
  const member = await findOrCreateMember(email);
  await createSession(member.id);

  // 초대 복귀: next가 있으면 거기로, 없으면 대시보드.
  return redirectTo(next ?? "/dashboard");
}
