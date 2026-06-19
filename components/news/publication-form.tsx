"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Plus, X } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import type { PublicationLink } from "@/lib/news";

// NEWS 추가/편집 폼 — 인터랙티브 섬(ADR-015). 추가/편집 공용(initial이 있으면 편집).
// CRITICAL: 티저 이미지는 프리사인 직접 업로드(클라→스토리지), API엔 객체 키만 보낸다(R36, kind:news).
// CRITICAL: teamId·createdBy는 서버가 세션/활성 팀에서 주입한다 — 클라가 보내지 않는다(R3/R37).
// 검증은 인라인(R30). DB·서명 URL은 직접 호출하지 않는다(읽기는 RSC).

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

const LINK_PRESETS = ["arXiv", "PDF", "코드", "프로젝트"] as const;

export interface PublicationInitial {
  id: string;
  title: string;
  venue: string;
  authors: string;
  year: number;
  month: number | null;
  links: PublicationLink[];
  teaserUrl: string | null;
}

export interface PublicationFormProps {
  /** 있으면 편집, 없으면 추가 */
  initial?: PublicationInitial;
  /** 모달로 띄울 때 닫기 콜백(인라인 사용 시 생략 가능) */
  onClose?: () => void;
}

export function PublicationForm({ initial, onClose }: PublicationFormProps) {
  const router = useRouter();
  const editing = Boolean(initial);

  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [venue, setVenue] = React.useState(initial?.venue ?? "");
  const [authors, setAuthors] = React.useState(initial?.authors ?? "");
  const [year, setYear] = React.useState(
    String(initial?.year ?? new Date().getFullYear()),
  );
  const [month, setMonth] = React.useState(
    initial?.month != null ? String(initial.month) : "",
  );
  const [links, setLinks] = React.useState<PublicationLink[]>(
    initial?.links ?? [],
  );
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // 기존 티저 미리보기(편집) 또는 새로 고른 파일 미리보기.
  // createObjectURL이 없는 환경(jsdom 등)에선 미리보기를 생략한다.
  const previewUrl = React.useMemo(() => {
    if (file) {
      try {
        return URL.createObjectURL(file);
      } catch {
        return null;
      }
    }
    return initial?.teaserUrl ?? null;
  }, [file, initial?.teaserUrl]);

  function addPreset(label: string) {
    setLinks((prev) => [...prev, { label, url: "" }]);
  }
  function updateLink(i: number, patch: Partial<PublicationLink>) {
    setLinks((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, j) => j !== i));
  }

  async function submit() {
    const t = title.trim();
    const v = venue.trim();
    const a = authors.trim();
    const y = Number(year);
    if (!t) return setError("제목을 입력해주세요.");
    if (!v) return setError("학회명을 입력해주세요.");
    if (!a) return setError("저자를 입력해주세요.");
    if (!Number.isInteger(y)) return setError("연도를 숫자로 입력해주세요.");

    setError(null);
    setBusy(true);
    try {
      let teaserImage: string | undefined;
      if (file) {
        // 1) 프리사인 URL 발급(서버는 서명만, R36) — 티저는 kind:news(이미지·news/ 키)
        const { uploadUrl, path } = await callJson<{
          uploadUrl: string;
          path: string;
        }>("/api/uploads/presign", {
          method: "POST",
          body: JSON.stringify({ filename: file.name, kind: "news" }),
        });
        // 2) 클라이언트가 스토리지에 직접 업로드
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!put.ok) throw new Error("이미지 업로드가 안 됐어요.");
        teaserImage = path;
      }

      // 완성된 링크 행만 보낸다(라벨·URL 둘 다 채워진 것). 서버가 zod로 재검증(400 방지).
      const cleanLinks = links
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.label.length > 0 && l.url.length > 0);

      const payload = {
        title: t,
        venue: v,
        authors: a,
        year: y,
        month: month.trim() ? Number(month) : undefined,
        teaserImage, // 새 파일 없으면 undefined → 서버는 기존 값 유지(PATCH)
        links: cleanLinks,
      };

      if (editing && initial) {
        await callJson<{ id: string }>(`/api/news/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        router.push(`/news/${initial.id}`);
      } else {
        await callJson<{ id: string }>("/api/news", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        router.push("/news");
      }
      router.refresh();
      onClose?.();
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof Error
          ? e.message
          : "실적을 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[color-mix(in_oklch,var(--fg)_28%,transparent)] p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose?.();
      }}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "실적 편집" : "실적 추가"}
        className="flex w-full max-w-lg flex-col gap-4 p-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-fg">
            {editing ? "실적 편집" : "실적 추가"}
          </h2>
          {onClose && (
            <button
              type="button"
              aria-label="닫기"
              onClick={onClose}
              disabled={busy}
              className="inline-flex size-8 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-50"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* 제목 */}
        <Field label="제목" htmlFor="pub-title">
          <Input
            id="pub-title"
            aria-label="제목"
            placeholder="예: Favoring One Among Equals"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>

        {/* 학회 */}
        <Field label="학회" htmlFor="pub-venue">
          <Input
            id="pub-venue"
            aria-label="학회"
            placeholder="예: NeurIPS 2025"
            value={venue}
            disabled={busy}
            onChange={(e) => setVenue(e.target.value)}
          />
        </Field>

        {/* 저자 */}
        <Field label="저자" htmlFor="pub-authors">
          <Input
            id="pub-authors"
            aria-label="저자"
            placeholder="쉼표로 구분 (예: 조성민, Jane Roe)"
            value={authors}
            disabled={busy}
            onChange={(e) => setAuthors(e.target.value)}
          />
        </Field>

        {/* 연도 / 월 */}
        <div className="flex gap-3">
          <Field label="연도" htmlFor="pub-year" className="flex-1">
            <Input
              id="pub-year"
              aria-label="연도"
              type="number"
              value={year}
              disabled={busy}
              onChange={(e) => setYear(e.target.value)}
            />
          </Field>
          <Field
            label="월 (선택)"
            htmlFor="pub-month"
            className="flex-1"
          >
            <Input
              id="pub-month"
              aria-label="월"
              type="number"
              min={1}
              max={12}
              placeholder="1–12"
              value={month}
              disabled={busy}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
        </div>

        {/* 링크 행 */}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-fg">
            링크 <span className="text-fg-subtle">(선택)</span>
          </span>
          {links.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`링크 ${i + 1} 라벨`}
                className="w-24 shrink-0"
                value={l.label}
                disabled={busy}
                onChange={(e) => updateLink(i, { label: e.target.value })}
              />
              <Input
                aria-label={`링크 ${i + 1} URL`}
                placeholder="https://"
                value={l.url}
                disabled={busy}
                onChange={(e) => updateLink(i, { url: e.target.value })}
              />
              <button
                type="button"
                aria-label={`링크 ${i + 1} 삭제`}
                onClick={() => removeLink(i)}
                disabled={busy}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-50"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {LINK_PRESETS.map((preset) => (
              <Button
                key={preset}
                variant="secondary"
                size="sm"
                disabled={busy}
                aria-label={`${preset} 링크 추가`}
                onClick={() => addPreset(preset)}
              >
                <Plus size={12} aria-hidden="true" />
                {preset}
              </Button>
            ))}
          </div>
        </div>

        {/* 티저 이미지 */}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-fg">
            티저 이미지 <span className="text-fg-subtle">(선택)</span>
          </span>
          <div className="flex items-center gap-3">
            <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md bg-bg-subtle text-fg-faint">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <ImageUp size={18} aria-hidden="true" />
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="티저 이미지 선택"
              disabled={busy}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFile(f);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {file || initial?.teaserUrl ? "이미지 바꾸기" : "이미지 선택"}
            </Button>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-[12px] text-busy">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {onClose && (
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              취소
            </Button>
          )}
          <Button onClick={submit} disabled={busy}>
            {busy ? "저장 중이에요…" : "저장"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * 추가/편집 폼을 여는 트리거 버튼(모달). 빈 상태 CTA·Topbar 액션·티저 편집에서 재사용.
 * children으로 버튼 라벨을 받고, initial이 있으면 편집 모드로 연다.
 */
export function PublicationFormButton({
  initial,
  children,
}: {
  initial?: PublicationInitial;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size={initial ? "sm" : "md"} variant={initial ? "secondary" : "primary"} onClick={() => setOpen(true)}>
        {!initial && <Plus size={14} aria-hidden="true" />}
        {children ?? "실적 추가"}
      </Button>
      {open && (
        <PublicationForm initial={initial} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
