"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Card } from "@/components/ui";

const focusable = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

export function ChatDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = React.useId();
  const overlay = React.useRef<HTMLDivElement>(null);
  const dialog = React.useRef<HTMLDivElement>(null);
  const restore = React.useRef(typeof document === "undefined" ? null : document.activeElement);
  React.useEffect(() => {
    const focused = restore.current;
    const overflow = document.body.style.overflow;
    const background = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== overlay.current).map((node) => ({ node, inert: node.inert }));
    background.forEach(({ node }) => { node.inert = true; });
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>(focusable)?.focus();
    return () => {
      background.forEach(({ node, inert }) => { node.inert = inert; });
      document.body.style.overflow = overflow;
      if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<div ref={overlay} className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--fg)_28%,transparent)] p-3" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <Card ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex max-h-[85dvh] w-full max-w-lg flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-token px-4 py-3">
        <h2 id={titleId} className="text-[16px] font-semibold text-fg">{title}</h2>
        <button type="button" aria-label={`${title} 닫기`} onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">{children}</div>
    </Card>
  </div>, document.body);
}
