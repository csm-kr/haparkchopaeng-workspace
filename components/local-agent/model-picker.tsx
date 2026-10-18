"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui";
import { useLocalAgent } from "./provider";
import { providerName } from "./presentation";

export function LocalAgentModelPicker() {
  const agent = useLocalAgent();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [position, setPosition] = React.useState({ top: 0, left: 0, width: 320 });
  const [portal, setPortal] = React.useState<HTMLElement | null>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const popup = React.useRef<HTMLDivElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  const options = agent?.device?.providers.flatMap((provider) => provider.status === "ready" ? provider.models.map((model) => ({ provider: provider.provider, model })) : []) ?? [];
  const allowed = agent?.phase === "connected" && options.length > 0;
  const selected = options.find((option) => option.provider === agent?.selectedModel?.provider && option.model.id === agent?.selectedModel?.model);
  const filtered = options.filter((option) => `${providerName[option.provider]} ${option.model.name} ${option.model.id}`.toLowerCase().includes(query.toLowerCase()));

  const close = React.useCallback((restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); }, []);
  React.useEffect(() => { if (!allowed) close(); }, [allowed, close]);
  React.useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const update = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
      const height = popup.current?.getBoundingClientRect().height ?? 300;
      setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: rect.bottom + 8 + height < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8) });
    };
    update(); search.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(); };
    const scroll = (event: Event) => { if (event.target instanceof Node && !popup.current?.contains(event.target)) close(); };
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", update); window.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", update); window.removeEventListener("scroll", scroll, true); };
  }, [open, close]);
  if (!agent) return null;

  function move(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!items.length) return;
    event.preventDefault();
    const index = items.findIndex((item) => item === document.activeElement);
    const target = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index <= 0 ? items.length : index) - 1;
    items[target]?.focus();
  }
  return <div className="flex min-w-0 flex-col gap-1.5" onBlur={(event) => {
    const target = event.relatedTarget;
    if (target instanceof Node && (popup.current?.contains(target) || trigger.current?.contains(target))) return;
    close();
  }}>
    <span className="text-[12px] font-medium text-fg-muted">사용할 모델</span>
    <button ref={trigger} type="button" disabled={!allowed} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      onClick={() => {
        if (open) { close(); return; }
        setQuery(""); setPortal(trigger.current?.closest('[role="dialog"]')?.parentElement ?? document.body); setOpen(true);
      }}
      className="inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-sm border border-border-strong bg-bg-elevated px-3 py-2 text-left text-[13px] text-fg hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:opacity-50">
      <span className="truncate">{selected ? `${providerName[selected.provider]} · ${selected.model.name}` : "모델을 선택하세요"}</span>
      <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-fg-subtle" />
    </button>
    {open && portal && createPortal(<div ref={popup} style={{ position: "fixed", ...position }} className="z-[60] flex flex-col rounded-md border border-border-strong bg-bg-elevated p-2 shadow-[var(--shadow-lg)]" onKeyDown={move}>
      <div className="relative">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute top-3.5 left-3 text-fg-subtle" />
        <Input ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="모델 검색" placeholder="모델 검색" className="pl-9" />
      </div>
      <div id={listId} role="listbox" aria-label="사용 가능한 모델" className="mt-2 max-h-[35dvh] overflow-y-auto">
        {filtered.length === 0 && <p className="p-3 text-[12px] text-fg-muted">맞는 모델이 없어요.</p>}
        {filtered.map((option) => {
          const active = selected?.provider === option.provider && selected.model.id === option.model.id;
          return <button key={`${option.provider}:${option.model.id}`} type="button" role="option" aria-selected={active}
            onClick={() => { agent.selectModel({ provider: option.provider, model: option.model.id }); close(true); }}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-[13px] text-fg hover:bg-bg-hover focus-visible:bg-accent-faint focus-visible:outline-none">
            <span className="flex min-w-0 flex-col"><span className="truncate">{option.model.name}</span><span className="text-[11px] text-fg-subtle">{providerName[option.provider]}</span></span>
            {active && <Check size={14} aria-hidden="true" className="shrink-0 text-accent" />}
          </button>;
        })}
      </div>
      <p className="mt-1 border-t border-border-token px-3 pt-2 pb-1 text-[11px] text-fg-muted">이 PC의 CLI가 제공한 모델이에요.</p>
    </div>, portal)}
  </div>;
}
