"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize,
  Minimize,
} from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

// PDF 슬라이드 뷰어 — 첨부 PDF를 pdf.js로 "한 페이지씩" 렌더한다(클라이언트 섬).
// 이전/다음(또는 ←/→)으로 넘기고, 전체화면 토글로 발표 화면을 크게 본다.
// 자산 라우트(/api/presentations/:id/assets/:assetId)는 단기 서명 URL로 302 리디렉트한다(R36).
// pdf.js는 effect 안에서 동적 import → SSR 안전. 워커는 번들 자산(new URL)으로 로드해 CDN 의존을 없애고
// 버전을 자동 일치시킨다. 로드 실패(미지원 브라우저 등)는 새 탭 열기 fallback으로 받는다.

export interface PdfSlideViewerProps {
  presentationId: string;
  assetId: string;
  /** 접근성 제목에 쓸 발표 제목 */
  name: string;
}

export function PdfSlideViewer({
  presentationId,
  assetId,
  name,
}: PdfSlideViewerProps) {
  const src = `/api/presentations/${presentationId}/assets/${assetId}`;

  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  // PDFDocumentProxy / RenderTask — pdf.js 타입은 동적 import라 여기선 좁게 보관.
  const docRef = React.useRef<{
    numPages: number;
    getPage: (n: number) => Promise<PdfPage>;
  } | null>(null);
  // 문서 해제는 PDFDocumentProxy가 아니라 getDocument()가 준 loading task에서 한다(v6).
  const loadingTaskRef = React.useRef<{ destroy: () => Promise<void> } | null>(
    null,
  );
  const renderTaskRef = React.useRef<{ cancel?: () => void } | null>(null);

  const [numPages, setNumPages] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [isFs, setIsFs] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);

  // 문서 로드 — 마운트 1회. pdf.js 동적 import → 워커 설정 → getDocument.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        // withCredentials는 끈다(기본): same-origin 첫 요청은 어차피 세션 쿠키를 보내 인증되고,
        // 서버가 cross-origin 서명 URL로 302하면 그 응답은 비인증으로 받아야 한다.
        // (Supabase 스토리지의 CORS가 보통 `*`라 credentials 모드면 fetch가 막힌다, R36.)
        const task = pdfjs.getDocument({ url: src });
        loadingTaskRef.current = task;
        const doc = await task.promise;
        if (!active) return; // cleanup이 task를 destroy한다.
        docRef.current = doc as unknown as NonNullable<typeof docRef.current>;
        setNumPages(doc.numPages);
        setPage(1);
      } catch {
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
      renderTaskRef.current?.cancel?.();
      void loadingTaskRef.current?.destroy?.();
      loadingTaskRef.current = null;
      docRef.current = null;
    };
  }, [src]);

  // 현재 페이지 렌더 — 페이지/전체화면 변경·창 크기 변경·로드 완료 시.
  React.useEffect(() => {
    if (numPages === 0) return;
    let cancelled = false;

    const draw = async () => {
      const doc = docRef.current;
      const canvas = canvasRef.current;
      if (!doc || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      renderTaskRef.current?.cancel?.();
      let pdfPage: PdfPage;
      try {
        pdfPage = await doc.getPage(page);
      } catch {
        return;
      }
      if (cancelled) return;

      const dpr = window.devicePixelRatio || 1;
      const base = pdfPage.getViewport({ scale: 1 });
      let scale: number;
      if (isFs) {
        // 전체화면: 컨트롤바 여유를 남기고 페이지 전체가 들어오도록 맞춘다.
        const availW = window.innerWidth;
        const availH = window.innerHeight - 64;
        scale = Math.min(availW / base.width, availH / base.height);
      } else {
        // 일반: 가로폭에 맞춘다.
        const hostW = canvas.parentElement?.clientWidth || base.width;
        scale = hostW / base.width;
      }
      if (!(scale > 0)) scale = 1;

      const viewport = pdfPage.getViewport({ scale: scale * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

      const task = pdfPage.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        // 다음 렌더로 취소된 경우 — 무시.
      }
    };

    void draw();
    const onResize = () => void draw();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
    };
  }, [numPages, page, isFs]);

  // 전체화면 상태 동기화 — 이 컨테이너가 전체화면일 때만 true.
  React.useEffect(() => {
    const el = containerRef.current;
    const onChange = () => setIsFs(document.fullscreenElement === el);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement === el) void document.exitFullscreen?.();
    };
  }, []);

  const goPrev = () => setPage((p) => Math.max(1, p - 1));
  const goNext = () => setPage((p) => Math.min(numPages || 1, p + 1));

  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else
      void containerRef.current
        ?.requestFullscreen?.()
        .then(() => containerRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-label="슬라이드">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold text-fg">슬라이드</h2>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-muted hover:text-fg"
        >
          <ExternalLink size={14} aria-hidden="true" />
          새 탭에서 열기
        </a>
      </div>
      <Card>
        <div
          ref={containerRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className={cn(
            "relative outline-none",
            isFs && "h-screen w-screen bg-black",
          )}
        >
          {/* 페이지 캔버스 */}
          <div
            className={cn(
              "grid place-items-center overflow-hidden",
              isFs ? "h-full bg-black" : "min-h-[300px] bg-bg-subtle p-2",
            )}
          >
            {loadError ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <p className="text-[13px] text-fg-muted">
                  이 브라우저에서 슬라이드를 표시할 수 없어요.
                </p>
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] font-medium text-accent hover:underline"
                >
                  새 탭에서 PDF 열기
                </a>
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                aria-label={`${name} 슬라이드 ${page}페이지`}
                className="max-h-full max-w-full"
              />
            )}
            {numPages === 0 && !loadError && (
              <p className="absolute text-[13px] text-fg-subtle">
                불러오는 중…
              </p>
            )}
          </div>

          {/* 전체화면 토글 — 우상단 */}
          <button
            type="button"
            aria-label={isFs ? "전체화면 종료" : "전체화면"}
            onClick={toggleFs}
            className="absolute top-2 right-2 z-20 grid size-8 place-items-center rounded-md bg-bg-elevated/90 text-fg-muted shadow-[var(--shadow-sm)] hover:bg-bg-hover hover:text-fg"
          >
            {isFs ? (
              <Minimize size={15} aria-hidden="true" />
            ) : (
              <Maximize size={15} aria-hidden="true" />
            )}
          </button>

          {/* 페이지 컨트롤 — 일반은 하단 중앙(흐름), 전체화면은 하단 오버레이 */}
          {numPages > 0 && (
            <div
              className={cn(
                "flex items-center justify-center gap-3",
                isFs
                  ? "absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-bg-elevated/90 px-3 py-1.5 shadow-[var(--shadow-sm)] backdrop-blur"
                  : "border-t border-border-token bg-bg-elevated px-3 py-2",
              )}
            >
              <button
                type="button"
                aria-label="이전 페이지"
                onClick={goPrev}
                disabled={page <= 1}
                className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <span className="min-w-[56px] text-center font-mono text-[12px] text-fg-muted tabular-nums">
                {`${page} / ${numPages}`}
              </span>
              <button
                type="button"
                aria-label="다음 페이지"
                onClick={goNext}
                disabled={page >= numPages}
                className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}

/** pdf.js 페이지 — 동적 import라 필요한 표면만 좁게 선언. */
interface PdfPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void>; cancel?: () => void };
}
