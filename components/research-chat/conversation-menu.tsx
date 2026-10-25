"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Trash2 } from "lucide-react";

const WIDTH = 248;

/** ⋯ menu for one conversation. It is fixed to the viewport so the scrolling list never clips it, and deletion asks once more (R27). */
export function ConversationMenu({ title, triggerLabel, onDelete, className = "" }: { title: string; triggerLabel: string; onDelete: () => Promise<boolean>; className?: string }) {
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const messageId = React.useId();
  const [position, setPosition] = React.useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const close = React.useCallback((restoreFocus = true) => {
    setPosition(null); setConfirming(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  function toggle() {
    if (position) { close(); return; }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 8));
    // Open upward near the bottom edge so the confirmation stays on screen.
    setPosition(rect.bottom + 180 > window.innerHeight ? { left, bottom: window.innerHeight - rect.top + 4 } : { left, top: rect.bottom + 4 });
  }
  React.useEffect(() => {
    if (position) panel.current?.querySelector<HTMLElement>("button")?.focus();
  }, [position, confirming]);
  React.useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(false); };
    // A fixed panel would drift away from its row while the list scrolls.
    const moved = (event: Event) => { if (!(event.target instanceof Node && panel.current?.contains(event.target))) close(false); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("scroll", moved, true); window.removeEventListener("resize", moved); };
  }, [position, close]);
  async function remove() {
    setBusy(true);
    const removed = await onDelete();
    setBusy(false);
    close(!removed);
  }
  return <>
    <button ref={trigger} type="button" aria-label={triggerLabel} aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={toggle}
      className={`grid size-8 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ${className}`}>
      <MoreHorizontal size={16} aria-hidden="true" />
    </button>
    {position && typeof document !== "undefined" && createPortal(<div ref={panel} style={{ position: "fixed", left: position.left, top: position.top, bottom: position.bottom, width: WIDTH }}
      className="z-[60] rounded-md border border-border-strong bg-bg-elevated p-1 shadow-[var(--shadow-lg)]"
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      {!confirming ? <div role="menu" aria-label="대화 관리">
        <button type="button" role="menuitem" onClick={() => setConfirming(true)} className="flex min-h-10 w-full items-center gap-2 rounded-sm px-3 text-left text-[13px] font-medium text-busy hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none">
          <Trash2 size={14} aria-hidden="true" />삭제
        </button>
      </div> : <div role="alertdialog" aria-label="대화 삭제 확인" aria-describedby={messageId} className="flex flex-col gap-3 p-2">
        <p id={messageId} className="break-words text-[12px] leading-relaxed text-fg-muted">「{title}」 대화를 삭제할까요? 질문과 답변이 모두 지워지고 되돌릴 수 없어요.</p>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => close()} className="min-h-9 rounded-sm border border-border-strong px-3 text-[12px] font-medium text-fg hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:opacity-50">취소</button>
          <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-9 rounded-sm bg-busy px-3 text-[12px] font-medium text-accent-fg hover:opacity-90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:opacity-50">{busy ? "삭제 중…" : "삭제"}</button>
        </div>
      </div>}
    </div>, document.body)}
  </>;
}
