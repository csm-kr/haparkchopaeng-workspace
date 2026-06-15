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

// ── 논문 분석 완료 전파 ───────────────────────────────────────────────
// 분석 잡이 끝나면 팀 채널로 push → 열린 논문 상세는 자동 갱신, 전역 배너로 알림(라이브와 동일 패턴).
// CRITICAL: 팀별 채널이라 다른 팀에 새지 않는다(ADR-020/R37).

/**
 * 논문 분석 완료 채널(팀별). 클라이언트(PaperNotifyProvider)도 이 함수를 import해
 * 같은 채널을 구독한다 — server 전용 코드(createSupabaseAdmin)는 트리셰이킹으로 빠진다(LIVE_CHANNEL과 동일).
 */
export function papersChannel(teamId: string): string {
  return `papers:${teamId}`;
}

/**
 * 논문 분석 완료를 팀 채널에 브로드캐스트한다(서버 전용). graceful: 미설정/실패는 삼킨다(throw 금지).
 */
export async function broadcastPaperAnalyzed(input: {
  paperId: string;
  teamId: string;
  title: string;
}): Promise<void> {
  try {
    const supabase = createSupabaseAdmin();
    const channel = supabase.channel(papersChannel(input.teamId));
    await channel.send({
      type: "broadcast",
      event: "paper.analyzed",
      payload: { paperId: input.paperId, title: input.title },
    });
    await supabase.removeChannel(channel);
  } catch (e) {
    console.warn("[realtime] broadcastPaperAnalyzed 실패(무시):", e);
  }
}
