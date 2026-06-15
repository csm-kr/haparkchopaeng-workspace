"use client";

import * as React from "react";

// 송출 타이머 + LIVE 표시 헤더. LiveKit 컨텍스트가 필요 없다 — 경과는 startedAt에서 파생.
// CRITICAL: LIVE는 색에만 의존하지 않는다 — 색 알약 + "LIVE" 텍스트 병행, 펄스는
//   prefers-reduced-motion에서 정적으로(globals.css의 anim-livepulse가 처리, R29).

/** 초 → "mm:ss"(1시간↑은 "h:mm:ss"). 프로토타입 fmtElapsed 재현. 음수는 0으로 클램프. */
export function fmtElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const sec = s % 60;
  const totalMin = Math.floor(s / 60);
  const min = totalMin % 60;
  const hr = Math.floor(totalMin / 60);
  const mm = String(min).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return hr > 0 ? `${hr}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface MeetHeaderProps {
  /** 서버 LiveSession.startedAt (ISO 문자열 또는 epoch ms). 없으면 00:00. */
  startedAt?: string | number | null;
  /** 발표 중인 사람 이름(없으면 일반 카피). */
  presenterName?: string | null;
  /** 현재 시각 주입(테스트용). 기본 Date.now. */
  now?: () => number;
  /** 우측 액션(종료/나가기 등). LiveKit 컨텍스트 밖에서도 동작해야 하므로 prop으로 받는다. */
  action?: React.ReactNode;
}

export function MeetHeader({
  startedAt,
  presenterName,
  now = Date.now,
  action,
}: MeetHeaderProps) {
  const start =
    startedAt == null
      ? null
      : typeof startedAt === "number"
        ? startedAt
        : Date.parse(startedAt);

  // 1초마다 다시 그린다(틱). 경과 자체는 now()-start로 파생해 드리프트가 없다.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsedSec =
    start == null || Number.isNaN(start)
      ? 0
      : Math.max(0, Math.floor((now() - start) / 1000));

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex min-w-0 items-center gap-2 text-[13px] font-medium text-fg">
        <span
          aria-hidden="true"
          className="anim-livepulse size-2 shrink-0 rounded-full bg-busy"
        />
        <span className="shrink-0 rounded-[10px] bg-busy/10 px-2 py-0.5 text-[11px] font-semibold text-busy">
          LIVE
        </span>
        <span className="font-mono text-[12px] text-fg-muted tabular-nums">
          {fmtElapsed(elapsedSec)}
        </span>
        <span className="truncate text-fg-subtle">
          {presenterName ? `· ${presenterName}님이 발표 중` : "· 세미나 진행 중"}
        </span>
      </span>
      {action}
    </div>
  );
}
