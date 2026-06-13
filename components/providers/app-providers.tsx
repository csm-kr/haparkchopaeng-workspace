"use client";

import * as React from "react";
import { ThemeProvider } from "./theme-provider";
import { LiveProvider } from "./live-provider";

// 앱 레벨 클라이언트 컨텍스트 묶음. RSC 레이아웃 안에서 이 한 섬이
// 테마·live 상태를 보유한다(ADR-015: 상호작용만 클라이언트).
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LiveProvider>{children}</LiveProvider>
    </ThemeProvider>
  );
}
