"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, UploadCloud, X } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";

// 발표자료 올리기 모달 — 인터랙티브 섬(ADR-015). 제목(+발표 시간)과 슬라이드 파일(PDF·PPTX, 선택).
// CRITICAL: 파일은 프리사인 직접 업로드(클라→스토리지), 생성 API엔 객체 키만 보낸다(R36).
// CRITICAL: 발표자(presenterId)는 서버가 세션에서 정한다 — 클라가 보내지 않는다(R3).
// 검증은 인라인(R30). 제목만 있으면 파일 없이도 추가할 수 있다.

interface ApiShape<T> {
  data?: T;
  error?: { code: string; message: string };
}

async function callJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const json: ApiShape<T> = await res.json().catch(() => ({}));
  if (!res.ok || !json.data) {
    throw new Error(json.error?.message ?? "요청을 처리하지 못했어요.");
  }
  return json.data;
}

function isSlideFile(file: File): boolean {
  const n = file.name.toLowerCase();
  return n.endsWith(".pdf") || n.endsWith(".pptx");
}

/** 표시용 파일 크기(예: "2.1MB"). 저장은 표시 목적뿐이다. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function contentTypeOf(file: File): string {
  return file.name.toLowerCase().endsWith(".pptx")
    ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    : "application/pdf";
}

export function CreatePresentationButton() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" />
        발표자료 올리기
      </Button>
      {open && <CreateModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [duration, setDuration] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function chooseFile(f: File) {
    if (!isSlideFile(f)) {
      setError("PDF 또는 PPTX만 올릴 수 있어요.");
      return;
    }
    setError(null);
    setFile(f);
    // 제목이 비어 있으면 파일명에서 채운다(편집 가능).
    if (!title.trim()) setTitle(f.name.replace(/\.(pdf|pptx)$/i, ""));
  }

  async function submit() {
    const t = title.trim();
    if (!t) {
      setError("발표 제목을 입력해주세요.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      let asset:
        | { objectPath: string; filename: string; size: string }
        | undefined;
      if (file) {
        // 1) 프리사인 URL 발급(서버는 서명만, R36)
        const { uploadUrl, path } = await callJson<{
          uploadUrl: string;
          path: string;
        }>("/api/uploads/presign", {
          method: "POST",
          body: JSON.stringify({ filename: file.name, kind: "presentation" }),
        });
        // 2) 클라이언트가 스토리지에 직접 업로드
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentTypeOf(file) },
          body: file,
        });
        if (!put.ok) throw new Error("업로드가 안 됐어요.");
        asset = { objectPath: path, filename: file.name, size: formatSize(file.size) };
      }
      // 3) 발표 자료 생성(객체 키만 전달, 발표자는 서버가 세션에서)
      const pres = await callJson<{ id: string }>("/api/presentations", {
        method: "POST",
        body: JSON.stringify({
          title: t,
          duration: duration.trim() || undefined,
          asset,
        }),
      });
      onClose();
      router.push(`/presentations/${pres.id}`);
    } catch {
      setBusy(false);
      setError("발표를 추가하지 못했어요. 잠시 후 다시 시도해주세요.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--fg)_28%,transparent)] p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose();
      }}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label="발표자료 업로드"
        className="flex w-full max-w-md flex-col gap-4 p-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-fg">발표자료 업로드</h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            disabled={busy}
            className="inline-flex size-8 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-50"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* 제목 */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pres-title" className="text-[13px] font-medium text-fg">
            발표 제목
          </label>
          <Input
            id="pres-title"
            aria-label="발표 제목"
            placeholder="예: MoD 주간 세미나"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* 발표 시간(선택) */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="pres-duration"
            className="text-[13px] font-medium text-fg"
          >
            발표 시간 <span className="text-fg-subtle">(선택)</span>
          </label>
          <Input
            id="pres-duration"
            aria-label="발표 시간"
            placeholder="예: 30분"
            value={duration}
            disabled={busy}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>

        {/* 슬라이드 파일(선택) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) chooseFile(f);
          }}
          className={
            "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center " +
            (dragging ? "border-accent bg-accent-faint" : "border-border-strong")
          }
        >
          <UploadCloud size={22} className="text-fg-subtle" aria-hidden="true" />
          <p className="text-[13px] font-medium text-fg">
            {file ? file.name : "슬라이드 파일을 끌어다 놓으세요 (선택)"}
          </p>
          <p className="text-[12px] text-fg-subtle">
            {file
              ? formatSize(file.size)
              : "PDF · PPTX 파일을 올릴 수 있어요."}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.pptx,application/pdf"
            aria-label="슬라이드 파일 선택"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) chooseFile(f);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileText size={13} aria-hidden="true" />
            {file ? "파일 바꾸기" : "파일 선택"}
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-[12px] text-busy">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy ? "올리는 중이에요…" : "발표자료 올리기"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
