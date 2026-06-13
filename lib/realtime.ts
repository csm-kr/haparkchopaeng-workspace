import { createSupabaseAdmin } from "@/lib/supabase/admin";

// 라이브 전이 실시간 전파(서버 전용) — Supabase Realtime broadcast(ADR-014→016/R33).
// CRITICAL: 폴링/SSE가 아니라 푸시다. start/end 라우트가 이 헬퍼로 전이를 브로드캐스트하고,
// 클라이언트(LiveProvider)는 같은 채널을 구독해 배지·배너·룸을 동시 갱신한다(S4.5).
// CRITICAL: service role 키는 서버 전용·호출 시점(admin.ts, R2). 클라는 anon 키만(browser.ts).

/** 클라이언트와 공유하는 라이브 채널 이름(이 값만 클라가 import). */
export const LIVE_CHANNEL = "live";

export type LiveEvent = "live.started" | "live.ended";

/**
 * 라이브 전이를 Supabase Realtime 채널에 브로드캐스트한다.
 *
 * graceful: Supabase 키 부재/전송 실패는 삼킨다(throw 금지). 전이 전파는 best-effort라
 * start/end API를 실패시키지 않는다. 미설정 시에는 createSupabaseAdmin이 throw하므로 catch한다.
 */
export async function broadcastLive(
  event: LiveEvent,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabase = createSupabaseAdmin();
    const channel = supabase.channel(LIVE_CHANNEL);
    // 구독하지 않은 채널의 send는 HTTP broadcast로 전송된다(서버 fire-and-forget).
    await channel.send({ type: "broadcast", event, payload });
    await supabase.removeChannel(channel);
  } catch (e) {
    console.warn("[realtime] broadcastLive 실패(무시):", e);
  }
}
