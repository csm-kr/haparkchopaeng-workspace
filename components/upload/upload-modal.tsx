"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, UploadCloud, X } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import type { QuotaStatus } from "@/lib/rate-limit";

// 업로드 모달 — 인터랙티브 섬(ADR-015). PDF 드래그앤드롭 또는 논문 URL(arXiv·학술 화이트리스트, ADR-003).
// CRITICAL: PDF 전용 — PPTX/MD·빈 노트/아이디어 메모 단축 없음(R12/ADR-003).
// CRITICAL: 업로드는 프리사인 직접 업로드(클라→스토리지), POST /api/papers엔 객체 키만(R36).
// CRITICAL: 업로드 성공 ≠ 분석 성공 — 분석은 서버가 pending으로 두고 잡이 처리(R28). 여기선 실행하지 않는다.
// 검증은 인라인(R30). 단계: idle → uploading → done(상세로 이동).

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

function isPdf(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

type Step = "idle" | "uploading" | "done";

export function UploadButton({ quota }: { quota?: QuotaStatus }) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" />
        논문 올리기
      </Button>
      {open && <UploadModal quota={quota} onClose={() => setOpen(false)} />}
    </>
  );
}

function UploadModal({
  quota,
  onClose,
}: {
  quota?: QuotaStatus;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("idle");
  const [dragging, setDragging] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [sourceError, setSourceError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function done(id: string) {
    setStep("done");
    onClose();
    router.push(`/papers/${id}`);
  }

  async function uploadFile(file: File) {
    // 한도 소진 시 시도 자체를 막고 안내(서버도 429로 막지만 UX상 미리 차단).
    if (quota?.remaining === 0) {
      setFileError("이번 주 분석 한도를 다 썼어요.");
      return;
    }
    // PDF 전용 검증 — 인라인 에러, 업로드 시도하지 않는다(R12/R30).
    if (!isPdf(file)) {
      setFileError("PDF만 올릴 수 있어요.");
      return;
    }
    setFileError(null);
    setSourceError(null);
    setStep("uploading");
    try {
      // 1) 프리사인 URL 발급(서버는 서명만, R36)
      const { uploadUrl, path } = await callJson<{
        uploadUrl: string;
        path: string;
      }>("/api/uploads/presign", {
        method: "POST",
        body: JSON.stringify({ filename: file.name }),
      });
      // 2) 클라이언트가 스토리지에 직접 업로드
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!put.ok) throw new Error("업로드가 안 됐어요.");
      // 3) Paper 생성(객체 키만 전달, 분석은 서버가 pending으로 둠)
      const paper = await callJson<{ id: string }>("/api/papers", {
        method: "POST",
        body: JSON.stringify({ objectPath: path, filename: file.name }),
      });
      done(paper.id);
    } catch (e) {
      setStep("idle");
      // 서버가 준 메시지(한도 초과·30쪽 초과 등)를 그대로 노출한다 — 원인을 알려야 한다(R30).
      setFileError(
        e instanceof Error
          ? e.message
          : "업로드가 안 됐어요. 파일을 확인하고 다시 시도해주세요.",
      );
    }
  }

  async function importUrl() {
    if (quota?.remaining === 0) {
      setSourceError("이번 주 분석 한도를 다 썼어요.");
      return;
    }
    const value = sourceUrl.trim();
    if (!value) {
      setSourceError("논문 주소를 입력해주세요.");
      return;
    }
    setSourceError(null);
    setFileError(null);
    setStep("uploading");
    try {
      // 서버가 화이트리스트 호스트(arXiv·학술)에서 PDF를 가져온다(SSRF는 서버에서 강제).
      const paper = await callJson<{ id: string }>("/api/papers", {
        method: "POST",
        body: JSON.stringify({ sourceUrl: value }),
      });
      done(paper.id);
    } catch (e) {
      setStep("idle");
      // 서버 메시지(한도 초과·30쪽 초과 등)를 그대로 노출한다(R30).
      setSourceError(
        e instanceof Error ? e.message : "논문 주소를 확인해주세요.",
      );
    }
  }

  const busy = step === "uploading";

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
        aria-label="논문 업로드"
        className="flex w-full max-w-md flex-col gap-4 p-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-fg">논문 업로드</h2>
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

        {quota && quota.limit > 0 && (
          <p className="text-[12px] text-fg-subtle">
            이번 주 분석{" "}
            <span className="font-mono text-fg">
              {quota.used}/{quota.limit}
            </span>
            {quota.remaining === 0 && (
              <span className="text-busy"> · 한도를 다 썼어요</span>
            )}
          </p>
        )}

        {/* PDF 전용 드롭존 */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void uploadFile(file);
          }}
          className={
            "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center " +
            (dragging ? "border-accent bg-accent-faint" : "border-border-strong")
          }
        >
          <UploadCloud size={24} className="text-fg-subtle" aria-hidden="true" />
          <p className="text-[14px] font-medium text-fg">
            {busy ? "올리는 중이에요…" : "PDF를 여기로 끌어다 놓으세요"}
          </p>
          <p className="text-[12px] text-fg-subtle">PDF 파일만 올릴 수 있어요.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            aria-label="PDF 파일 선택"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileText size={13} aria-hidden="true" />
            파일 선택
          </Button>
          {fileError && (
            <p role="alert" className="text-[12px] text-busy">
              {fileError}
            </p>
          )}
        </div>

        {/* 논문 URL 입력(arXiv·학술 화이트리스트 PDF) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="source-url" className="text-[13px] font-medium text-fg">
            또는 논문 URL로 가져오기
          </label>
          <div className="flex items-start gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Input
                id="source-url"
                aria-label="논문 주소"
                placeholder="arXiv 또는 CVF·OpenReview 등 PDF 주소"
                value={sourceUrl}
                disabled={busy}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
              {sourceError && (
                <p role="alert" className="text-[12px] text-busy">
                  {sourceError}
                </p>
              )}
            </div>
            <Button onClick={importUrl} disabled={busy}>
              가져오기
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
