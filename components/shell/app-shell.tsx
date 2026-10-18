"use client";

import * as React from "react";
import { Sidebar } from "./sidebar";
import type { ShellMember, ShellTeam } from "./types";

// 셸 레이아웃 섬 — collapsed 상태를 보유하고 사이드바 + 콘텐츠 영역을 배치한다.
// 데이터는 서버 레이아웃에서 props로 받는다(ADR-015).

export interface AppShellProps {
  members: ShellMember[];
  currentUser: ShellMember;
  teams?: ShellTeam[];
  activeTeamSlug?: string | null;
  children: React.ReactNode;
}

export function AppShell({
  members,
  currentUser,
  teams = [],
  activeTeamSlug = null,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const smallScreen = window.matchMedia("(max-width: 767px)");
    // 첫 서버/클라이언트 렌더를 같게 유지하고, 마운트 후 기존 64px 레일을 사용한다.
    setCollapsed(smallScreen.matches);
    const change = (event: MediaQueryListEvent) => setCollapsed(event.matches);
    smallScreen.addEventListener("change", change);
    return () => smallScreen.removeEventListener("change", change);
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar
        members={members}
        currentUser={currentUser}
        teams={teams}
        activeTeamSlug={activeTeamSlug}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
