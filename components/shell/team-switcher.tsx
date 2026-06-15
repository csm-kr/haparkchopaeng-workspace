"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ShellTeam } from "./types";

// 셸 팀 전환(ADR-018/ADR-020) — 현재 팀 표시 + 다른 팀으로 전환.
// 전환은 POST /api/teams/active로 활성 팀 쿠키를 바꾼 뒤 router.refresh()로 RSC를 다시 그린다.
// 데이터는 서버 레이아웃에서 props로 받고(ADR-015), 멤버십 검증은 서버가 한다(R19).

export interface TeamSwitcherProps {
  teams: ShellTeam[];
  activeSlug: string | null;
}

export function TeamSwitcher({ teams, activeSlug }: TeamSwitcherProps) {
  const router = useRouter();
  const [switching, setSwitching] = React.useState(false);

  if (teams.length === 0) return null;
  const active = teams.find((t) => t.slug === activeSlug) ?? teams[0];
  const others = teams.filter((t) => t.slug !== active.slug);

  async function switchTo(slug: string) {
    setSwitching(true);
    try {
      const res = await fetch("/api/teams/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <section
      aria-label="팀 전환"
      className="mx-2 mb-1 rounded-sm border border-border-token bg-bg-subtle px-2.5 py-2"
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">현재 팀</p>
      <p className="truncate text-[13px] font-semibold text-fg" title={active.name}>
        {active.name}
      </p>
      {others.length > 0 && (
        <ul aria-label="다른 팀" className="mt-1.5 flex flex-col gap-0.5 border-t border-border-token pt-1.5">
          {others.map((t) => (
            <li key={t.slug}>
              <button
                type="button"
                onClick={() => switchTo(t.slug)}
                disabled={switching}
                title={t.name}
                className="block w-full truncate rounded-sm px-1.5 py-1 text-left text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-50"
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
