"use client";

import * as React from "react";
import { createPortal } from "react-dom";

export interface QuotaWindowView {
  id: string;
  label: string;
  remainingPercent: number | null;
  resetsAt: string | null;
  observedAt: string | null;
  freshness: "fresh" | "stale" | "unknown";
}

function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function Ring({ window }: { window: QuotaWindowView }) {
  const known = window.remainingPercent !== null && Number.isFinite(window.remainingPercent);
  const remaining = known ? Math.max(0, Math.min(100, window.remainingPercent!)) : 0;
  const state = !known ? "unknown" : window.freshness === "stale" ? "stale" : remaining === 0 ? "empty" : "fresh";
  const color = state === "empty" ? "var(--busy)" : state === "stale" || state === "unknown" ? "var(--fg-subtle)" : "var(--accent)";
  return <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" data-testid="usage-ring" data-state={state} className="shrink-0">
    <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--border-strong)" strokeWidth="2.5" strokeDasharray={state === "unknown" ? "2 3" : undefined} />
    {known && remaining > 0 && <circle cx="10" cy="10" r="7.5" fill="none" stroke={color} strokeWidth="2.5" pathLength="100" strokeDasharray={`${remaining} ${100 - remaining}`} strokeLinecap="round" transform="rotate(-90 10 10)" />}
    {state === "empty" && <circle cx="10" cy="10" r="1.5" fill={color} />}
  </svg>;
}

/** 비율은 공급자가 관측한 구독 한도다. 토큰 개수를 추정하지 않는다. */
export function QuotaBadge({ windows, compact = false, label = "사용량 상세" }: { windows: QuotaWindowView[]; compact?: boolean; label?: string }) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ top: 0, left: 0 });
  const trigger = React.useRef<HTMLButtonElement>(null);
  const tooltip = React.useRef<HTMLDivElement>(null);
  const pointerOpen = React.useRef<boolean | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = React.useId();
  const clearClose = React.useCallback(() => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; }, []);
  const show = () => { clearClose(); setOpen(true); };
  const close = () => { clearClose(); setOpen(false); };
  const leave = () => {
    clearClose();
    closeTimer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current) setOpen(false);
    }, 120);
  };
  React.useEffect(() => clearClose, [clearClose]);
  React.useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const locate = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 24);
      const height = tooltip.current?.getBoundingClientRect().height ?? 240;
      setPosition({
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: rect.bottom + 8 + height <= window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8),
      });
    };
    locate();
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", close, true);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !tooltip.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  // close only reads stable refs and setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (windows.length === 0) return null;
  return <>
    <button ref={trigger} type="button" aria-label={label} aria-describedby={open ? tooltipId : undefined}
      className={`inline-flex shrink-0 items-center rounded-sm text-[11px] text-fg-muted hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ${compact ? "min-h-11 min-w-11 justify-center gap-1 px-1" : "min-h-10 gap-2 px-2"}`}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") show(); }} onPointerLeave={leave}
      onPointerDown={() => { pointerOpen.current = open; }}
      onFocus={show} onBlur={close}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}
      onClick={(event) => {
        const wasOpen = pointerOpen.current; pointerOpen.current = null;
        if (event.detail === 0 || wasOpen === null) show();
        else if (window.matchMedia?.("(hover: none)").matches) { clearClose(); setOpen(!wasOpen); }
      }}>
      {windows.map((window) => <span key={window.id} className="inline-flex items-center gap-1"><Ring window={window} />{!compact && <span aria-hidden="true">{window.id}</span>}</span>)}
    </button>
    {open && createPortal(<div ref={tooltip} id={tooltipId} role="tooltip" onPointerEnter={clearClose} onPointerLeave={leave}
      style={{ position: "fixed", top: position.top, left: position.left, width: "min(288px, calc(100vw - 24px))" }}
      className="z-[60] flex flex-col gap-3 rounded-md border border-border-strong bg-bg-elevated p-4 text-[12px] text-fg shadow-[var(--shadow-lg)]">
      {windows.map((window) => <div key={window.id} className="flex flex-col gap-0.5">
        <span className="font-medium">{window.label}</span>
        <span className="text-[14px] font-semibold">{window.remainingPercent === null ? "정보를 제공하지 않아요" : `${window.remainingPercent}% 남음`}</span>
        {window.freshness === "stale" && <span className="text-fg-muted">이전 확인값</span>}
        {dateLabel(window.resetsAt) && <span className="text-fg-muted">{dateLabel(window.resetsAt)} 초기화</span>}
        {dateLabel(window.observedAt) && <span className="text-fg-subtle">{dateLabel(window.observedAt)} 확인</span>}
      </div>)}
      <p className="border-t border-border-token pt-2 text-[11px] leading-relaxed text-fg-muted">정확한 잔여 토큰 수를 의미하지 않아요.</p>
    </div>, document.body)}
  </>;
}
