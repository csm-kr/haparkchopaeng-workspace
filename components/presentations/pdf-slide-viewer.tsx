"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize,
  Minimize,
} from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

// PDF 슬라이드 뷰어 — 첨부 PDF를 서버가 페이지 PNG로 렌더한 것(/pages/:n)을 <img>로 한 장씩 보여준다(클라이언트 섬).
// 클라이언트 pdf.js 캔버스 렌더 대신 서버 래스터 이미지를 쓰므로 페이지 전환이 즉각적이다 — <img src> 스왑 +
// 인접 페이지 프리로드(브라우저 캐시, 라우트 max-age=3600)로 ←/→가 바로 넘어간다.
// 이전/다음(또는 ←/→)으로 넘기고, 전체화면 토글로 발표 화면을 크게 본다.
// 페이지 이미지 라우트는 인증 자산이라 일반 <img>(쿠키 전송)로 받는다(R36, 라이브 무대와 동일 경로).
// "PDF 받기"는 원본 PDF 자산을 새 창에서 연다.

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
  const pdfHref = `/api/presentations/${presentationId}/assets/${assetId}`;
  const pageSrc = (n: number) =>
    `/api/presentations/${presentationId}/pages/${n}`;

  const containerRef = React.useRef<HTMLDivElement>(null);

  const [numPages, setNumPages] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [isFs, setIsFs] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);

  // 페이지 수 로드 — 마운트 1회. 라이브 공유와 같은 카운트 라우트를 쓴다.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/presentations/${presentationId}/pages`);
        if (!res.ok) throw new Error();
        const json = (await res.json()) as { data?: { count?: number } };
        const count = json.data?.count ?? 0;
        if (!active) return;
        if (count < 1) {
          setLoadError(true);
          return;
        }
        setNumPages(count);
        setPage(1);
      } catch {
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [presentationId]);

  // 인접 페이지 프리로드 — 다음/이전을 미리 받아 두면 화살표가 바로 넘어간다(이미지 캐시).
  React.useEffect(() => {
    if (numPages === 0) return;
    for (const n of [page + 1, page - 1]) {
      if (n >= 1 && n <= numPages) {
        const img = new Image();
        img.src = pageSrc(n);
      }
    }
    // pageSrc는 presentationId만 의존 — 안정적이라 deps에서 생략.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, numPages, presentationId]);

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
          href={pdfHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-muted hover:text-fg"
        >
          <Download size={14} aria-hidden="true" />
          PDF 받기
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
          {/* 페이지 이미지 */}
          <div
            className={cn(
              "grid place-items-center overflow-hidden",
              isFs ? "h-full bg-black" : "min-h-[300px] bg-bg-subtle p-2",
            )}
          >
            {loadError ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <p className="text-[13px] text-fg-muted">
                  슬라이드를 표시할 수 없어요.
                </p>
                <a
                  href={pdfHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] font-medium text-accent hover:underline"
                >
                  새 창에서 PDF 열기
                </a>
              </div>
            ) : numPages > 0 ? (
              // 인증 자산 라우트라 next/image(서버 최적화)는 부적합 — 일반 img(쿠키 전송).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pageSrc(page)}
                alt={`${name} 슬라이드 ${page}페이지`}
                onError={() => setLoadError(true)}
                className={cn(
                  "object-contain",
                  isFs ? "max-h-full max-w-full" : "max-h-full w-full",
                )}
              />
            ) : (
              <p className="text-[13px] text-fg-subtle">불러오는 중…</p>
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
