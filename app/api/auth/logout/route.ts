import { destroySession, getConnectionSession } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revokeSession } from "@/lib/local-agent/service";

// POST /api/auth/logout — Supabase signOut + 앱 세션 파기(둘 다). 세션은 lib/auth로 일원화(ADR-017).
export async function POST(): Promise<Response> {
  try {
    // Revoke server-side execution before removing the cookie that identifies its grants.
    // The finally block still signs the browser out if storage or the IdP is unavailable.
    try {
      const session = await getConnectionSession();
      if (session) await revokeSession(session.sessionKey);
    } finally {
      // Supabase 신원 세션 파기. 키가 없거나 IdP 세션이 없어도 앱 세션은 반드시 파기한다.
      try {
        const supabase = await createSupabaseServerClient();
        await supabase.auth.signOut();
      } catch {
        /* IdP signOut 실패가 앱 로그아웃을 막지 않는다 */
      }
      await destroySession();
    }
    return ok({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
