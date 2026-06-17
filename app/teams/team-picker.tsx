"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// 팀 허브 선택 섬(ADR-021) — 내 팀 목록에서 하나를 골라 활성 팀으로 전환하고 대시보드로 들어간다.
// 전환은 POST /api/teams/active로 활성 팀 쿠키를 바꾼다 — team-switcher와 동일 패턴.
// CRITICAL: 멤버십 검증은 기존 /api/teams/active 서버가 한다(R19) — 여기서 새 검증 경로를 만들지 않는다.

export interface TeamPickerProps {
  teams: { slug: string; name: string; role: string }[];
}

export function TeamPicker({ teams }: TeamPickerProps) {
  const router = useRouter();
  const [switching, setSwitching] = React.useState(false);

  if (teams.length === 0) return null;

  async function enter(slug: string) {
    setSwitching(true);
    try {
      const res = await fetch("/api/teams/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (res.ok) router.push("/dashboard");
      else setSwitching(false);
    } catch {
      setSwitching(false);
    }
  }

  return (
    <ul aria-label="내 팀" className="flex flex-col gap-2">
      {teams.map((t) => (
        <li key={t.slug}>
          <button
            type="button"
            onClick={() => void enter(t.slug)}
            disabled={switching}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-border-token bg-bg-elevated px-3.5 py-3 text-left hover:border-border-strong hover:bg-bg-hover disabled:opacity-50"
          >
            <span className="truncate text-[14px] font-semibold text-fg">{t.name}</span>
            <span className="shrink-0 text-[11px] uppercase tracking-wide text-fg-subtle">
              {t.role}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
