"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

// 발표 자료 삭제 — 파괴적 액션이라 확인을 거친다(R27). 권한은 서버가 최종 강제(R3),
// 버튼 노출은 페이지에서 발표자/관리자에게만.

export function DeletePresentationButton({
  presentationId,
  title,
}: {
  presentationId: string;
  title: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/presentations/${presentationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? "삭제하지 못했어요.");
        setBusy(false);
        return;
      }
      router.push("/presentations");
      router.refresh();
    } catch {
      setError("잠시 후 다시 시도해주세요.");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-sm border border-border-strong bg-bg-elevated px-3.5 py-[7px] text-[13px] font-medium text-busy hover:bg-bg-subtle"
      >
        <Trash2 size={14} aria-hidden="true" />
        삭제
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-fg-muted">
        「{title}」 삭제할까요? 댓글·버전도 함께 지워져요.
      </span>
      <button
        type="button"
        onClick={doDelete}
        disabled={busy}
        className="rounded-sm bg-busy px-3 py-[7px] text-[13px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "삭제 중…" : "삭제"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="rounded-sm border border-border-strong px-3 py-[7px] text-[13px] font-medium text-fg hover:bg-bg-subtle"
      >
        취소
      </button>
      {error && (
        <span role="alert" className="text-[12px] text-busy">
          {error}
        </span>
      )}
    </div>
  );
}
