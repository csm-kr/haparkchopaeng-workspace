"use client";

import * as React from "react";
import { Sidebar } from "./sidebar";
import type { ShellMember } from "./types";

// 셸 레이아웃 섬 — collapsed 상태를 보유하고 사이드바 + 콘텐츠 영역을 배치한다.
// 데이터는 서버 레이아웃에서 props로 받는다(ADR-015).

export interface AppShellProps {
  members: ShellMember[];
  currentUser: ShellMember;
  children: React.ReactNode;
}

export function AppShell({ members, currentUser, children }: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar
        members={members}
        currentUser={currentUser}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
