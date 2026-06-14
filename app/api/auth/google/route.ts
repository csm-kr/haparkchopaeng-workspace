import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { sanitizeNext } from "@/lib/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/auth/google — Supabase Auth로 Google OAuth 시작 → Google 인증 URL로 리디렉트.
// 멀티팀(ADR-018): 로그인은 누구나 — 콜백이 findOrCreateMember로 해소한다(거부 게이트 없음).
// 로그인 후 복귀 목적지(next, 예: /invite/{token})를 정제해 콜백 redirectTo에 실어 보낸다.

/**
 * Supabase에 Google provider가 켜져 있는지 확인.
 * 안 켜진 채로 authorize로 보내면 Supabase가 400을 던져 "죽은" 화면이 된다 — 미리 막는다.
 * 키/네트워크 실패 시 false(안전).
 */
async function isGoogleEnabled(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { external?: { google?: boolean } };
    return json.external?.google === true;
  } catch {
    return false;
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const next = sanitizeNext(new URL(req.url).searchParams.get("next"));

    // 아직 Google이 설정 전이면 400 크래시 대신 로그인 화면으로 안내(R30).
    if (!(await isGoogleEnabled())) {
      const back = new URL("/?authError=google", req.url);
      if (next) back.searchParams.set("next", next); // 설정 후 재시도 시 복귀 보존
      return NextResponse.redirect(back);
    }

    const supabase = await createSupabaseServerClient();
    const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
    // 콜백 redirectTo에 정제된 next를 실어 보낸다(콜백이 다시 정제 — 방어적, SECURITY).
    const callback = new URL("/auth/callback", base);
    if (next) callback.searchParams.set("next", next);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    if (error || !data.url) {
      return toErrorResponse(error ?? new Error("OAuth URL을 받지 못했어요."));
    }
    return NextResponse.redirect(data.url);
  } catch (e) {
    return toErrorResponse(e);
  }
}
