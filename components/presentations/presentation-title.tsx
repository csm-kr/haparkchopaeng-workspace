"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button, Input } from "@/components/ui";

// 발표 자료 이름(제목) 인라인 편집 — 상세 헤더 h1. 연필 버튼으로 입력창을 열고 PATCH로 저장한다.
// 권한은 서버가 강제(팀 멤버 누구나, 발표자 제한 없음) — 노출은 모두에게.
// 저장 성공 시 router.refresh()로 RSC를 다시 받아 브레드크럼·h1을 함께 갱신한다(ADR-015).

const H1_CLASS =
  "min-w-0 text-[28px] leading-tight font-bold tracking-[-0.025em] text-fg break-words [overflow-wrap:anywhere]";

export function PresentationTitleEditable({
  presentationId,
  initialTitle,
}: {
  presentationId: string;
  initialTitle: string;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState(initialTitle);
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(initialTitle);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function startEdit() {
    setValue(title);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    const next = value.trim();
    if (!next || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/presentations/${presentationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? "이름을 바꾸지 못했어요.");
      }
      setTitle(next); // 낙관적 표시 — 서버 데이터는 refresh로 정합 맞춘다.
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "이름을 바꾸지 못했어요.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <h1 className={H1_CLASS}>{title}</h1>
        <button
          type="button"
          aria-label="이름 변경"
          onClick={startEdit}
          className="mt-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-faint hover:bg-bg-hover hover:text-fg"
        >
          <Pencil size={15} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          aria-label="발표 자료 이름"
          value={value}
          autoFocus
          disabled={saving}
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
        />
        <Button onClick={save} disabled={saving || value.trim().length === 0}>
          저장
        </Button>
        <Button variant="secondary" onClick={cancel} disabled={saving}>
          취소
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-busy">
          {error}
        </p>
      )}
    </div>
  );
}
