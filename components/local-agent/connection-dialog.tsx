"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Card } from "@/components/ui";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

/** 연결 UI 전용 모달. 배경 포커스 차단과 복원은 모달 수명에 묶는다. */
export function ConnectionDialog({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = React.useId();
  const overlay = React.useRef<HTMLDivElement>(null);
  const dialog = React.useRef<HTMLDivElement>(null);
  const previousFocus = React.useRef(typeof document === "undefined" ? null : document.activeElement);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // 취소·인증 전이로 포커스된 버튼이 사라져도 다음 키 입력은 모달 안에 머문다.
  React.useLayoutEffect(() => {
    if (overlay.current && !overlay.current.contains(document.activeElement)) {
      dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
  });

  React.useEffect(() => {
    const restoreFocus = previousFocus.current;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay.current)
      .map((element) => ({ element, inert: element.inert }));
    background.forEach(({ element }) => { element.inert = true; });
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const outsideKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof Node && overlay.current?.contains(event.target))) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const items = Array.from(overlay.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
      }
    };
    document.addEventListener("keydown", outsideKey);

    return () => {
      document.removeEventListener("keydown", outsideKey);
      background.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = previousOverflow;
      if (restoreFocus instanceof HTMLElement && restoreFocus.isConnected) restoreFocus.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={overlay}
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--fg)_28%,transparent)] p-4"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        if (event.key !== "Tab" || !dialog.current) return;
        const focusable = Array.from((overlay.current ?? dialog.current).querySelectorAll<HTMLElement>(FOCUSABLE))
          .filter((element) => !element.closest("[hidden]"));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) { event.preventDefault(); dialog.current.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }}
    >
      <Card
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[min(85dvh,720px)] w-full max-w-lg flex-col"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-token px-5 py-4">
          <h2 id={titleId} className="text-[20px] font-semibold text-fg">{title}</h2>
          <button type="button" aria-label="연결창 닫기" onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto p-5">{children}</div>
      </Card>
    </div>, document.body,
  );
}
