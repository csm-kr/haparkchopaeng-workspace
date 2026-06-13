"use client";

import * as React from "react";

// CRITICAL: `live`는 앱 레벨에 단 하나만 존재한다(ADR-001/R5).
// 화면 컴포넌트에 보관하지 않는다 — 사이드바 LIVE 알약·홈 배너·미팅 룸이 어긋난다.

interface LiveContextValue {
  live: boolean;
  setLive: (v: boolean) => void;
}

const LiveContext = React.createContext<LiveContextValue | null>(null);

/**
 * 라이브 전이 SSE 구독 골격 (ADR-014/R33).
 * `/api/live/stream`을 구독해 live.started/ended로 setLive를 호출한다.
 * 폴링이 아니라 단방향 EventSource 구독이다.
 *
 * 이 엔드포인트는 라이브 step에서 추가된다 — 그 전까지는 연결 실패를
 * 조용히 무시한다(graceful no-op). 404 등에서 재연결이 폭주하지 않도록 닫는다.
 */
function useLiveStream(setLive: (v: boolean) => void): void {
  React.useEffect(() => {
    if (typeof EventSource === "undefined") return;

    let es: EventSource;
    try {
      es = new EventSource("/api/live/stream");
    } catch {
      return; // 구독 자체가 불가능하면 무시
    }

    const onStarted = () => setLive(true);
    const onEnded = () => setLive(false);
    es.addEventListener("live.started", onStarted);
    es.addEventListener("live.ended", onEnded);
    // 엔드포인트 부재 시 조용히 닫는다(재연결 폭주 방지).
    es.onerror = () => es.close();

    return () => {
      es.removeEventListener("live.started", onStarted);
      es.removeEventListener("live.ended", onEnded);
      es.close();
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
  useLiveStream(setLive);

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
