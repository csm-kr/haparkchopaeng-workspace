import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/auth/google — Supabase Auth로 Google OAuth 시작 → Google 인증 URL로 리디렉트.
// 초대 게이트는 콜백(app/auth/callback)에서 — 인증 성공만으로 합류 금지(ADR-017).

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
    // 아직 Google이 설정 전이면 400 크래시 대신 로그인 화면으로 안내(R30).
    if (!(await isGoogleEnabled())) {
      return NextResponse.redirect(new URL("/?authError=google", req.url));
    }

    const supabase = await createSupabaseServerClient();
    const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${base}/auth/callback` },
    });
    if (error || !data.url) {
      return toErrorResponse(error ?? new Error("OAuth URL을 받지 못했어요."));
    }
    return NextResponse.redirect(data.url);
  } catch (e) {
    return toErrorResponse(e);
  }
}
