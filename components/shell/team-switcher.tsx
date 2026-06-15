import Link from "next/link";
import type { ShellTeam } from "./types";

// 셸 팀 전환(ADR-018) — 현재 팀 표시 + (여러 팀이면) 전환 링크. 최소 동작이며 전체 스타일은 step 4 소관.
// 데이터는 서버 레이아웃에서 props로 받는다(ADR-015). 엔티티는 아직 팀 스코핑 전이라(ADR-018 범위)
// 전환 링크는 팀 관리(/team)로 보낸다 — 진짜 스코프 전환은 팀 스코핑 단계에서 배선.

export interface TeamSwitcherProps {
  teams: ShellTeam[];
  activeSlug: string | null;
}

export function TeamSwitcher({ teams, activeSlug }: TeamSwitcherProps) {
  if (teams.length === 0) return null;
  const active = teams.find((t) => t.slug === activeSlug) ?? teams[0];
  const others = teams.filter((t) => t.slug !== active.slug);

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
              <Link
                href="/team"
                title={t.name}
                className="block truncate rounded-sm px-1.5 py-1 text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg"
              >
                {t.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
