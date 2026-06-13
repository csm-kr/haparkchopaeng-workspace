"use client";

import * as React from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { LIVE_CHANNEL } from "@/lib/realtime";

// CRITICAL: `live`는 앱 레벨에 단 하나만 존재한다(ADR-001/R5).
// 화면 컴포넌트에 보관하지 않는다 — 사이드바 LIVE 알약·홈 배너·미팅 룸이 어긋난다.

interface LiveContextValue {
  live: boolean;
  setLive: (v: boolean) => void;
}

const LiveContext = React.createContext<LiveContextValue | null>(null);

/**
 * 라이브 전이 Supabase Realtime 구독 (ADR-014→016/R33).
 * `LIVE_CHANNEL`을 구독해 broadcast 이벤트(live.started/ended)로 setLive를 호출한다.
 * 폴링이 아니라 단방향 푸시다 — setInterval/EventSource를 쓰지 않는다(R33).
 *
 * anon 키가 없으면(키 부재) 브라우저 클라이언트가 null → 조용히 no-op(graceful).
 * 언마운트 시 removeChannel로 정리해 재연결 폭주를 막는다.
 */
function useLiveRealtime(setLive: (v: boolean) => void): void {
  React.useEffect(() => {
    const supabase = createBrowserSupabase();
    if (!supabase) return; // 키 없음 → no-op

    const channel = supabase
      .channel(LIVE_CHANNEL)
      .on("broadcast", { event: "live.started" }, () => setLive(true))
      .on("broadcast", { event: "live.ended" }, () => setLive(false))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [setLive]);
}

export function LiveProvider({
  children,
  initialLive = false,
}: {
  children: React.ReactNode;
  initialLive?: boolean;
}) {
  const [live, setLive] = React.useState(initialLive);
  useLiveRealtime(setLive);

  const value = React.useMemo<LiveContextValue>(
    () => ({ live, setLive }),
    [live],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = React.useContext(LiveContext);
  if (!ctx) throw new Error("useLive는 LiveProvider 안에서만 사용할 수 있어요.");
  return ctx;
}
