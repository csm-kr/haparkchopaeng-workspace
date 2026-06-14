"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, UploadCloud, X } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";

// 업로드 모달 — 인터랙티브 섬(ADR-015). PDF 드래그앤드롭 또는 arXiv URL(ADR-003).
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

export function UploadButton() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" />
        논문 올리기
      </Button>
      {open && <UploadModal onClose={() => setOpen(false)} />}
    </>
  );
}

function UploadModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("idle");
  const [dragging, setDragging] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [arxivUrl, setArxivUrl] = React.useState("");
  const [arxivError, setArxivError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function done(id: string) {
    setStep("done");
    onClose();
    router.push(`/papers/${id}`);
  }

  async function uploadFile(file: File) {
    // PDF 전용 검증 — 인라인 에러, 업로드 시도하지 않는다(R12/R30).
    if (!isPdf(file)) {
      setFileError("PDF만 올릴 수 있어요.");
      return;
    }
    setFileError(null);
    setArxivError(null);
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
      setFileError(
        e instanceof Error
          ? "업로드가 안 됐어요. 파일을 확인하고 다시 시도해주세요."
          : "업로드가 안 됐어요. 파일을 확인하고 다시 시도해주세요.",
      );
    }
  }

  async function importArxiv() {
    const value = arxivUrl.trim();
    if (!value) {
      setArxivError("arXiv 주소를 입력해주세요.");
      return;
    }
    setArxivError(null);
    setFileError(null);
    setStep("uploading");
    try {
      // 서버가 arxiv.org에서 PDF를 가져온다(SSRF 화이트리스트는 서버에서 강제).
      const paper = await callJson<{ id: string }>("/api/papers", {
        method: "POST",
        body: JSON.stringify({ arxivUrl: value }),
      });
      done(paper.id);
    } catch {
      setStep("idle");
      setArxivError("arXiv 주소를 확인해주세요.");
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

        {/* arXiv URL 입력 */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="arxiv-url" className="text-[13px] font-medium text-fg">
            또는 arXiv 주소로 가져오기
          </label>
          <div className="flex items-start gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Input
                id="arxiv-url"
                aria-label="arXiv 주소"
                placeholder="https://arxiv.org/abs/2404.02258"
                value={arxivUrl}
                disabled={busy}
                onChange={(e) => setArxivUrl(e.target.value)}
              />
              {arxivError && (
                <p role="alert" className="text-[12px] text-busy">
                  {arxivError}
                </p>
              )}
            </div>
            <Button onClick={importArxiv} disabled={busy}>
              가져오기
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
