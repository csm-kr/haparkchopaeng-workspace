"use client";

import * as React from "react";
import { ThemeProvider } from "./theme-provider";
import { LiveProvider } from "./live-provider";

// 앱 레벨 클라이언트 컨텍스트 묶음. RSC 레이아웃 안에서 이 한 섬이
// 테마·live 상태를 보유한다(ADR-015: 상호작용만 클라이언트).
// initialLive는 서버(layout)에서 주입 — 첫 렌더부터 배지/배너가 정확하고
// 이후 전이는 Realtime이 갱신한다(ADR-001).
export function AppProviders({
  children,
  initialLive = false,
}: {
  children: React.ReactNode;
  initialLive?: boolean;
}) {
  return (
    <ThemeProvider>
      <LiveProvider initialLive={initialLive}>{children}</LiveProvider>
    </ThemeProvider>
  );
}
