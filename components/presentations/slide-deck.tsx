"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Card } from "@/components/ui";
import type { SlideView } from "./types";

// 슬라이드 덱 — 한 장씩 넘겨 보는 뷰어(클라이언트 섬, ADR-015).
// 이전/다음 버튼 · 좌우 화살표 키 · 썸네일 점프로 이동한다. 토큰만 사용(R20).
// 호출부(PresentationViewer)가 slides.length > 0을 보장하므로 현재 장은 항상 존재한다.

export interface SlideDeckProps {
  slides: SlideView[];
}

export function SlideDeck({ slides }: SlideDeckProps) {
  const [idx, setIdx] = React.useState(0);
  const total = slides.length;

  // 경계 보정: 어떤 이유로든 idx가 범위를 벗어나지 않게.
  const cur = Math.min(idx, total - 1);
  const slide = slides[cur];

  const go = React.useCallback(
    (next: number) => setIdx(Math.max(0, Math.min(total - 1, next))),
    [total],
  );

  return (
    <section
      className="flex flex-col gap-3 focus:outline-none"
      aria-label="슬라이드"
      aria-roledescription="슬라이드 뷰어"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(cur - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          go(cur + 1);
        }
      }}
    >
      <h2 className="text-[16px] font-semibold text-fg">슬라이드</h2>

      {/* 무대 — 현재 한 장 */}
      <Card className="flex min-h-[220px] flex-col gap-2 p-5">
        <span className="font-mono text-[11px] text-fg-faint">
          {String(cur + 1).padStart(2, "0")} /{" "}
          {String(total).padStart(2, "0")}
        </span>
        <p className="text-[18px] font-semibold text-fg">{slide.title}</p>
        {slide.subtitle && (
          <p className="text-[13px] text-fg-subtle">{slide.subtitle}</p>
        )}
        <p className="text-[14px] whitespace-pre-wrap text-fg-muted">
          {slide.body}
        </p>
      </Card>

      {/* 컨트롤 — 이전/다음 + 현재 위치 */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={cur === 0}
          onClick={() => go(cur - 1)}
        >
          <ChevronLeft size={14} aria-hidden="true" /> 이전
        </Button>
        <span className="font-mono text-[12px] tabular-nums text-fg-muted">
          {cur + 1} / {total}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={cur === total - 1}
          onClick={() => go(cur + 1)}
        >
          다음 <ChevronRight size={14} aria-hidden="true" />
        </Button>
      </div>

      {/* 썸네일 — 번호로 바로 점프 */}
      <div className="flex flex-wrap gap-1.5">
        {slides.map((s, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${i + 1}번 슬라이드`}
            aria-current={i === cur}
            onClick={() => go(i)}
            className={
              "size-8 rounded-sm font-mono text-[11px] transition-colors " +
              (i === cur
                ? "bg-accent text-accent-fg"
                : "bg-bg-subtle text-fg-muted hover:bg-bg-hover")
            }
          >
            {String(i + 1).padStart(2, "0")}
          </button>
        ))}
      </div>
    </section>
  );
}
