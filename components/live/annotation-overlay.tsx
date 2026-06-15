"use client";

import * as React from "react";
import { Crosshair, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

// 화면공유 위 주석 오버레이 — 발표자만 그린다(R7). 펜=스트로크(~3초 페이드), 레이저=점(~1.2초).
// 좌표는 영상 박스 기준 정규화(0..1) → 모두에게 같은 위치. viewBox 1600×900 고정 +
//   preserveAspectRatio=none: aspect-video(16:9) 박스라 균일 스케일(원이 타원으로 안 깨짐).
// CRITICAL: 그리기 좌표 전파는 부모(MeetRoom)가 데이터 채널로(ADR-019). 여기선 입력·렌더만.
// CRITICAL: 색은 토큰만(R20). stroke/fill은 style로 줘 var()가 resolve되게 한다.

const VB_W = 1600;
const VB_H = 900;
const LASER_THROTTLE_MS = 60;

/** 미팅 주석 색 — 토큰만(R20). 화면 위에서 구분되는 4색. */
export const ANNOT_COLORS = [
  "var(--busy)",
  "var(--away)",
  "var(--online)",
  "var(--accent)",
] as const;

export interface ActiveAnnotation {
  id: string;
  tool: "pen" | "laser";
  color: string;
  /** 정규화 좌표(0..1). 펜=스트로크, 레이저=한 점. */
  points: [number, number][];
}

export interface DrawInput {
  tool: "pen" | "laser";
  color: string;
  points: [number, number][];
}

type Rect = { left: number; top: number; width: number; height: number };

/** 포인터 client 좌표 → 박스 기준 정규화(0..1, clamp). 폭/높이 0이면 0. */
export function normalizePoint(
  clientX: number,
  clientY: number,
  rect: Rect,
): [number, number] {
  const c = (n: number) => Math.min(1, Math.max(0, n));
  const x = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const y = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  return [c(x), c(y)];
}

type Tool = "off" | "pen" | "laser";

export interface AnnotationOverlayProps {
  isPresenter: boolean;
  annotations: ActiveAnnotation[];
  /** 발표자가 그리면 호출(정규화 좌표). 없으면 그리기 비활성. */
  onDraw?: (input: DrawInput) => void;
}

export function AnnotationOverlay({
  isPresenter,
  annotations,
  onDraw,
}: AnnotationOverlayProps) {
  const [tool, setTool] = React.useState<Tool>("off");
  const [color, setColor] = React.useState<string>(ANNOT_COLORS[0]);
  const [draft, setDraft] = React.useState<[number, number][] | null>(null);
  const lastLaser = React.useRef(0);
  const svgRef = React.useRef<SVGSVGElement>(null);

  const drawing = isPresenter && tool !== "off" && !!onDraw;

  const pointOf = (e: React.PointerEvent): [number, number] => {
    const rect = svgRef.current?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
    return normalizePoint(e.clientX, e.clientY, rect);
  };

  function onPointerDown(e: React.PointerEvent) {
    if (!drawing) return;
    if (tool === "pen") {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDraft([pointOf(e)]);
    } else {
      onDraw?.({ tool: "laser", color, points: [pointOf(e)] });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawing) return;
    if (tool === "pen") {
      setDraft((d) => (d ? [...d, pointOf(e)] : d));
    } else {
      const now = Date.now();
      if (now - lastLaser.current < LASER_THROTTLE_MS) return;
      lastLaser.current = now;
      onDraw?.({ tool: "laser", color, points: [pointOf(e)] });
    }
  }

  function onPointerUp() {
    if (tool === "pen" && draft && draft.length > 0) {
      onDraw?.({ tool: "pen", color, points: draft });
    }
    setDraft(null);
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className={cn("absolute inset-0 size-full", drawing && "cursor-crosshair")}
        style={{ pointerEvents: drawing ? "auto" : "none", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {annotations.map((a) => (
          <AnnotShape key={a.id} annot={a} />
        ))}
        {draft && draft.length > 0 && (
          <polyline
            points={draft.map(([x, y]) => `${x * VB_W},${y * VB_H}`).join(" ")}
            fill="none"
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ stroke: color }}
          />
        )}
      </svg>

      {isPresenter && onDraw && (
        <div className="pointer-events-auto absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border-token bg-bg-elevated/95 px-1.5 py-1 shadow-[var(--shadow-lg)]">
          <ToolButton
            active={tool === "laser"}
            label="레이저 포인터"
            onClick={() => setTool((t) => (t === "laser" ? "off" : "laser"))}
          >
            <Crosshair size={15} aria-hidden="true" />
          </ToolButton>
          <ToolButton
            active={tool === "pen"}
            label="펜"
            onClick={() => setTool((t) => (t === "pen" ? "off" : "pen"))}
          >
            <Pencil size={15} aria-hidden="true" />
          </ToolButton>
          <span className="mx-0.5 h-5 w-px bg-border-token" aria-hidden="true" />
          {ANNOT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`색 ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cn(
                "size-5 rounded-full border",
                color === c ? "border-fg" : "border-border-token",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AnnotShape({ annot }: { annot: ActiveAnnotation }) {
  if (annot.tool === "laser") {
    const [x, y] = annot.points[0];
    return (
      <circle
        cx={x * VB_W}
        cy={y * VB_H}
        r={11}
        className="anim-annotfade-laser"
        style={{ fill: annot.color }}
      />
    );
  }
  return (
    <polyline
      points={annot.points.map(([x, y]) => `${x * VB_W},${y * VB_H}`).join(" ")}
      fill="none"
      strokeWidth={6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="anim-annotfade-pen"
      style={{ stroke: annot.color }}
    />
  );
}

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-sm",
        active
          ? "bg-accent-soft text-accent"
          : "text-fg-muted hover:bg-bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
