import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 브라우저용 Supabase 클라이언트 — Realtime 구독(LiveProvider)에서만 쓴다.
// CRITICAL: anon 키만 사용한다(공개 OK). service role 키는 절대 클라이언트에 노출하지 않는다(R2).
// 키 부재 시 null 반환(throw 금지) — 키 없이도 graceful no-op.

let cached: SupabaseClient | null | undefined;

/** anon 키 기반 브라우저 클라이언트. 키가 없으면 null(구독은 조용히 no-op). */
export function createBrowserSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    cached = null;
    return null;
  }

  cached = createClient(url, anonKey);
  return cached;
}
