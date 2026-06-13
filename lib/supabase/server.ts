import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Supabase 서버 클라이언트 (요청 시점 생성, 쿠키 연동). 신원 제공자(IdP)로만 쓰고
// 앱 권한 세션은 lib/auth가 따로 발급한다(ADR-016/017).
// CRITICAL: 환경변수는 모듈 로드가 아니라 호출 시점에 읽는다 — 키 없이도 next build 통과(R2).

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** 요청 쿠키와 연동된 Supabase 클라이언트. OAuth 시작/콜백에서 사용. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  // anon 키만 사용 — 공개 키이므로 클라이언트 노출 OK. service role 키는 admin.ts에서만(R2).
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Server Component에서 호출되면 set이 막힐 수 있다 — 무시(미들웨어/route에서 갱신).
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* noop */
          }
        },
      },
    },
  );
}
