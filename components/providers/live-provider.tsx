"use client";

import * as React from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { liveChannel } from "@/lib/realtime";

interface LiveSnapshot {
  live: boolean;
  sessionId: string | null;
}

interface LiveContextValue extends LiveSnapshot {
  setLive: (live: boolean, sessionId?: string) => void;
}

const LiveContext = React.createContext<LiveContextValue | null>(null);

export function LiveProvider({
  children,
  initialLive = false,
  initialSessionId = null,
  teamId = null,
}: {
  children: React.ReactNode;
  initialLive?: boolean;
  initialSessionId?: string | null;
  teamId?: string | null;
}) {
  const [snapshot, setSnapshot] = React.useState<LiveSnapshot>({
    live: initialLive,
    sessionId: initialLive ? initialSessionId : null,
  });
  const current = React.useRef(snapshot);
  const request = React.useRef(0);
  const pending = React.useRef<AbortController | null>(null);

  const cancelPending = React.useCallback(() => {
    request.current++;
    pending.current?.abort();
  }, []);

  const setLive = React.useCallback((live: boolean, sessionId?: string) => {
    // 이전 세션의 늦은 종료 응답으로 새 세션을 닫지 않는다.
    if (!live && sessionId && current.current.sessionId &&
      current.current.sessionId !== sessionId) return;
    cancelPending();
    current.current = {
      live, sessionId: live ? (sessionId ?? current.current.sessionId) : null,
    };
    setSnapshot(current.current);
  }, [cancelPending]);

  const refresh = React.useCallback(async () => {
    if (!teamId) return;
    cancelPending();
    const sequence = request.current;
    const controller = new AbortController();
    pending.current = controller;
    try {
      const response = await fetch("/api/live", {
        cache: "no-store",
        headers: { "X-Hapark-Team-Id": teamId },
        signal: controller.signal,
      });
      if (!response.ok) return;
      const body = await response.json();
      if (sequence !== request.current || controller.signal.aborted) return;
      if (body.data !== null && typeof body.data?.id !== "string") return;
      current.current = { live: !!body.data, sessionId: body.data?.id ?? null };
      setSnapshot(current.current);
    } catch {
      // 오프라인에서는 마지막 상태를 유지하고 연결 복귀 때 다시 확인한다.
    }
  }, [teamId, cancelPending]);

  // RSC 갱신도 서버 현재 상태를 조회한다. 오래된 props로 새 세션을 덮지 않는다.
  React.useEffect(() => { void refresh(); }, [refresh, initialLive, initialSessionId]);

  React.useEffect(() => {
    if (!teamId) return;
    const supabase = createBrowserSupabase();
    const onBroadcast = ({ payload }: { payload?: Record<string, unknown> }) => {
      // broadcast는 갱신 신호다. 지연·중복 알림의 내용으로 상태를 확정하지 않는다.
      if (payload?.teamId === teamId) void refresh();
    };
    const channel = supabase?.channel(liveChannel(teamId))
      .on("broadcast", { event: "live.started" }, onBroadcast)
      .on("broadcast", { event: "live.ended" }, onBroadcast)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
      });
    const onResume = () => { void refresh(); };
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", onResume);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelPending();
      window.removeEventListener("online", onResume);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onVisible);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [teamId, refresh, cancelPending]);

  const value = React.useMemo(() => ({ ...snapshot, setLive }), [snapshot, setLive]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = React.useContext(LiveContext);
  if (!ctx) throw new Error("useLive는 LiveProvider 안에서만 사용할 수 있어요.");
  return ctx;
}
