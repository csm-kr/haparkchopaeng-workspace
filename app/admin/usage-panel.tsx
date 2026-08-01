import type { LiveUsage } from "@/lib/live-usage";

// 라이브 사용량 표시(읽기 전용 서버 컴포넌트, ADR-024).
// CRITICAL: "추정치" 표기를 빼지 마라 — 재참가 병합·leftAt 누락으로 실제 과금과 다를 수 있다.

/** 한도 대비 소진 수준. 80% 이상 warn, 100% 이상 danger. */
function level(used: number, limit: number): "ok" | "warn" | "danger" {
  if (limit <= 0) return "ok";
  const ratio = used / limit;
  if (ratio >= 1) return "danger";
  return ratio >= 0.8 ? "warn" : "ok";
}

// 프로젝트 색 토큰(app/globals.css) — 별도 danger/warning 토큰이 없어 presence 토큰을 재사용한다.
const BAR_TONE = {
  ok: "bg-accent",
  warn: "bg-away",
  danger: "bg-busy",
} as const;

export interface UsagePanelProps {
  usage: LiveUsage;
  trend: { month: string; minutes: number }[];
}

export function UsagePanel({ usage, trend }: UsagePanelProps) {
  const tone = level(usage.usedMinutes, usage.limitMinutes);
  const percent = Math.min(100, Math.round((usage.usedMinutes / usage.limitMinutes) * 100));
  const fmt = (n: number) => `${n.toLocaleString("ko-KR")}분`;
  const maxTrend = Math.max(1, ...trend.map((t) => t.minutes));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-fg">이번 달 라이브 사용량</h2>
        <span className="rounded-full border border-border-token px-2 py-0.5 text-[11px] text-fg-subtle">
          추정치
        </span>
      </div>

      <div role="status" data-level={tone} className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[24px] font-bold tracking-[-0.02em] text-fg">
            {fmt(usage.usedMinutes)}
          </span>
          <span className="text-[13px] text-fg-muted">/ {fmt(usage.limitMinutes)}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-bg-elevated">
          <div className={`h-full ${BAR_TONE[tone]}`} style={{ width: `${percent}%` }} />
        </div>
        <p className="text-[13px] text-fg-muted">{fmt(usage.remainingMinutes)} 남았어요.</p>
      </div>

      <p className="text-[12px] text-fg-subtle">
        참가자-분 기준이에요(4명이 30분이면 120분). 재참가·비정상 종료 때문에 실제 LiveKit 과금과
        다를 수 있어요.
      </p>

      <div className="flex flex-col gap-2 border-t border-border-token pt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          최근 6개월
        </h3>
        <ul className="flex flex-col gap-1">
          {trend.map((t) => (
            <li key={t.month} className="flex items-center gap-2 text-[12px]">
              <span className="w-16 shrink-0 text-fg-subtle">{t.month}</span>
              <span
                className="h-2 rounded-full bg-accent"
                style={{ width: `${(t.minutes / maxTrend) * 100}%` }}
              />
              <span className="text-fg-muted">{fmt(t.minutes)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-token pt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">팀별</h3>
        {usage.byTeam.length === 0 ? (
          <p className="text-[13px] text-fg-subtle">이번 달 라이브 사용 기록이 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {usage.byTeam.map((t) => (
              <li key={t.teamId} className="flex justify-between text-[13px]">
                <span className="text-fg">{t.teamName}</span>
                <span className="text-fg-muted">{fmt(t.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
