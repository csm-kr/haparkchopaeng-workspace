"use client";

import type { FloatingReaction } from "./types";

// 플로팅 반응 레이어 — 수신한 반응 이모지를 잠깐 띄웠다 사라지게 한다.
// CRITICAL: 허용된 keyframe(floatup)만 사용하고, reduced-motion에서는 정적으로(globals.css, R29).
// 장식 정보이므로 aria-hidden — 의미 전달은 채팅/패널이 담당한다.

export interface ReactionsLayerProps {
  reactions: FloatingReaction[];
}

export function ReactionsLayer({ reactions }: ReactionsLayerProps) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {reactions.map((r) => (
        <span
          key={r.id}
          data-reaction
          className="anim-floatup absolute bottom-4 text-3xl"
          style={{ left: `${r.left}%` }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
