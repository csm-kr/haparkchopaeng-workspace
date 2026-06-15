"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, PanelLeft, PanelLeftClose, Sun } from "lucide-react";
import { Avatar } from "@/components/ui";
import { useLive, useTheme } from "@/components/providers";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";
import { TeamSwitcher } from "./team-switcher";
import type { ShellMember, ShellTeam } from "./types";

// 영속 사이드바 — 인터랙티브 섬(현재 경로·collapsed·live·theme)이다(ADR-015).
// 데이터(멤버·현재 사용자·팀)는 서버에서 props로 받는다.

export interface SidebarProps {
  members: ShellMember[];
  currentUser: ShellMember;
  teams?: ShellTeam[];
  activeTeamSlug?: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * LIVE 알약 — 색(빨강)에만 의존하지 않고 "LIVE" 텍스트를 병행한다(R29).
 * 깜빡임(anim-livepulse)은 prefers-reduced-motion에서 정적으로 대체된다(globals.css).
 */
function LivePill() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[10px] bg-busy px-1.5 py-0.5 text-[10px] font-semibold text-accent-fg"
      aria-label="진행 중인 라이브"
    >
      <span
        aria-hidden="true"
        className="anim-livepulse size-1.5 rounded-full bg-accent-fg"
      />
      LIVE
    </span>
  );
}

export function Sidebar({
  members,
  currentUser,
  teams = [],
  activeTeamSlug = null,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const { live } = useLive();
  const { theme, toggleTheme } = useTheme();

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col border-r border-border-token bg-bg-elevated transition-[width]",
        collapsed ? "w-[64px]" : "w-[260px]",
      )}
    >
      {/* 로고 + 접기 토글 — 접히면 64px 폭에 로고+토글이 안 들어가 겹치므로 세로로 쌓는다 */}
      <div
        className={cn(
          "flex px-3 py-4",
          collapsed ? "flex-col items-center gap-2" : "items-center gap-2",
        )}
      >
        <Link
          href="/dashboard"
          className="flex min-w-0 items-center gap-2"
          title="모두의모임"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-[13px] font-bold text-accent-fg">
            모모
          </span>
          {!collapsed && (
            <span className="truncate text-[15px] font-semibold text-fg">
              모두의모임
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg",
            !collapsed && "ml-auto",
          )}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* 현재 팀 + 팀 전환(ADR-018) — 접힘 상태에선 숨긴다(레이블 폭 부족) */}
      {!collapsed && <TeamSwitcher teams={teams} activeSlug={activeTeamSlug} />}

      {/* 내비 목록 */}
      <nav
        aria-label="주요 메뉴"
        className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2"
      >
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const showLive = Boolean(item.live && live);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.label}
              className={cn(
                "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-accent-soft text-accent"
                  : "text-fg-muted hover:bg-bg-hover hover:text-fg",
              )}
            >
              <item.Icon size={16} className="shrink-0" />
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {!collapsed && showLive && <LivePill />}
              {!collapsed && !showLive && item.count != null && (
                <span className="rounded-[10px] bg-bg-subtle px-1.5 py-0.5 text-[11px] text-fg-subtle">
                  {item.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* 멤버 목록 (클릭 → 팀 관리) */}
      {!collapsed && members.length > 0 && (
        <div className="border-t border-border-token px-2 py-3">
          <p className="px-2 pb-1.5 text-[11px] font-medium text-fg-subtle">
            멤버 {members.length}
          </p>
          <ul className="flex flex-col gap-0.5">
            {members.map((m) => (
              <li key={m.id}>
                <Link
                  href="/team"
                  title={m.name}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-bg-hover"
                >
                  <Avatar user={m} size="sm" />
                  <span className="flex-1 truncate text-[12px] text-fg-muted">
                    {m.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 푸터: 현재 사용자(설정) + 테마 토글 */}
      <div className="flex items-center gap-2 border-t border-border-token px-3 py-3">
        <Link
          href="/profile"
          title="설정"
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <Avatar user={currentUser} size="sm" />
          {!collapsed && (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12px] font-medium text-fg">
                {currentUser.name}
              </span>
              <span className="truncate text-[11px] text-fg-subtle">
                {currentUser.role}
              </span>
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "라이트 테마로 전환" : "다크 테마로 전환"}
          className="grid size-8 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </aside>
  );
}
