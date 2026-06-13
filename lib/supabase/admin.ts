import { createClient } from "@supabase/supabase-js";

// Supabase 관리(service role) 클라이언트 — 서버 전용.
// CRITICAL: SUPABASE_SERVICE_ROLE_KEY는 절대 클라이언트 번들/NEXT_PUBLIC_에 노출하지 않는다(R2, SECURITY §비밀).
// CRITICAL: 환경변수는 호출 시점에 읽는다 — 키 없이도 next build 통과.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** service role 권한의 Supabase 클라이언트. 세션을 보존하지 않는다(요청마다 신규). */
export function createSupabaseAdmin() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
