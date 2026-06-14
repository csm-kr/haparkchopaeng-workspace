"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Trash2 } from "lucide-react";

// 점 3개(⋮) 오버플로 메뉴로 삭제. 파괴적이라 메뉴 안에서 한 번 더 확인한다(R27).
// 권한은 서버가 최종 강제(작성자만, R3) — 버튼 노출은 페이지에서 작성자에게만.

export function DeleteMenu({
  endpoint,
  redirectTo,
  title,
  cascadeNote,
}: {
  endpoint: string;
  redirectTo: string;
  title: string;
  cascadeNote: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function close() {
    setOpen(false);
    setConfirming(false);
    setError(null);
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? "삭제하지 못했어요.");
        setBusy(false);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("잠시 후 다시 시도해주세요.");
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="더보기"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex size-8 items-center justify-center rounded-sm border border-border-strong bg-bg-elevated text-fg-muted hover:bg-bg-subtle"
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* 바깥 클릭 시 닫힘 */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-border-strong bg-bg-elevated p-1 shadow-lg">
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-[13px] font-medium text-busy hover:bg-bg-subtle"
              >
                <Trash2 size={14} aria-hidden="true" />
                삭제
              </button>
            ) : (
              <div className="flex flex-col gap-2 p-2">
                <p className="text-[12px] leading-relaxed text-fg-muted">
                  「{title}」 삭제할까요? {cascadeNote}
                </p>
                {error && (
                  <p role="alert" className="text-[12px] text-busy">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="rounded-sm border border-border-strong px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-bg-subtle disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={doDelete}
                    disabled={busy}
                    className="rounded-sm bg-busy px-3 py-1.5 text-[12px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? "삭제 중…" : "삭제"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
