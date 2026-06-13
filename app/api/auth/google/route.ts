import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/auth/google — Supabase Auth로 Google OAuth 시작 → Google 인증 URL로 리디렉트.
// 초대 게이트는 콜백(app/auth/callback)에서 — 인증 성공만으로 합류 금지(ADR-017).

export async function GET(): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const base = process.env.APP_BASE_URL ?? "";
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
