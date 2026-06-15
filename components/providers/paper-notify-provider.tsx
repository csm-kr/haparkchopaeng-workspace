"use client";

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { papersChannel } from "@/lib/realtime";

// 논문 분석 완료 알림 — 팀 채널(papers:{teamId})을 한 번 구독해 두 가지를 구동한다(ADR-019 패턴):
//   1) 열려 있는 논문 상세의 자동 갱신(onAnalyzed 리스너 → router.refresh)
//   2) 앱 어디에 있든 보이는 전역 배너(자리를 떠 있어도 완료를 알림)
// CRITICAL: 폴링이 아니라 단방향 푸시다(R33). anon 키/teamID 부재 시 조용히 no-op(graceful).
// CRITICAL: provider 없이 usePaperNotify가 쓰여도 throw하지 않는다 — no-op 기본값(논문 상세 단독 렌더 등).

export interface PaperAnalyzedEvent {
  paperId: string;
  title: string;
}

type Listener = (e: PaperAnalyzedEvent) => void;

interface PaperNotifyValue {
  /** 분석 완료 이벤트를 구독한다. 반환 함수로 해지. */
  onAnalyzed: (cb: Listener) => () => void;
}

const PaperNotifyContext = React.createContext<PaperNotifyValue>({
  onAnalyzed: () => () => {},
});

interface Notice extends PaperAnalyzedEvent {
  id: string;
}

const NOTICE_TTL_MS = 8000;

export function PaperNotifyProvider({
  teamId,
  children,
}: {
  teamId?: string | null;
  children: React.ReactNode;
}) {
  const listenersRef = React.useRef<Set<Listener>>(new Set());
  const [notices, setNotices] = React.useState<Notice[]>([]);

  const onAnalyzed = React.useCallback((cb: Listener) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setNotices((ns) => ns.filter((n) => n.id !== id));
  }, []);

  const handle = React.useCallback(
    (e: PaperAnalyzedEvent) => {
      // 열린 논문 상세의 자동 갱신 리스너에 먼저 전파.
      for (const cb of listenersRef.current) cb(e);
      // 전역 배너(잠시 후 자동 사라짐).
      const id = `${e.paperId}-${Date.now()}`;
      setNotices((ns) => [...ns, { id, ...e }]);
      setTimeout(() => dismiss(id), NOTICE_TTL_MS);
    },
    [dismiss],
  );

  React.useEffect(() => {
    if (!teamId) return; // 팀 없음 → no-op
    const supabase = createBrowserSupabase();
    if (!supabase) return; // 키 없음 → no-op
    const channel = supabase
      .channel(papersChannel(teamId))
      .on(
        "broadcast",
        { event: "paper.analyzed" },
        // Supabase broadcast 전달 형태: { type, event, payload }. 형식 위반은 무시(방어적).
        (msg: { type: string; event: string; payload: PaperAnalyzedEvent }) => {
          if (msg.payload?.paperId) handle(msg.payload);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId, handle]);

  const value = React.useMemo<PaperNotifyValue>(
    () => ({ onAnalyzed }),
    [onAnalyzed],
  );

  return (
    <PaperNotifyContext.Provider value={value}>
      {children}
      {notices.length > 0 && (
        <div className="fixed top-3 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
          {notices.map((n) => (
            <PaperNotice
              key={n.id}
              notice={n}
              onDismiss={() => dismiss(n.id)}
            />
          ))}
        </div>
      )}
    </PaperNotifyContext.Provider>
  );
}

/** 전역 완료 배너 — 색만이 아니라 아이콘+텍스트(R29). 클릭 시 논문으로 이동. */
function PaperNotice({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-border-token bg-bg-elevated px-3 py-2 shadow-[var(--shadow-lg)]"
    >
      <span aria-hidden="true">📄</span>
      <Link
        href={`/papers/${notice.paperId}`}
        onClick={onDismiss}
        className="text-[13px] font-medium text-fg hover:underline"
      >
        {notice.title} 분석이 끝났어요 · 보기 →
      </Link>
      <button
        type="button"
        aria-label="알림 닫기"
        onClick={onDismiss}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-bg-hover hover:text-fg"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function usePaperNotify(): PaperNotifyValue {
  return React.useContext(PaperNotifyContext);
}
