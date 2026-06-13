"use client";

import * as React from "react";

// 앱 레벨 테마 상태. 라이트/다크는 <html data-theme> 오버라이드만으로 전환한다(R20).
// CRITICAL: 컴포넌트에 테마 분기 로직을 넣지 않는다 — 토큰(var(--…))이 [data-theme]로 바뀐다.

export type Theme = "light" | "dark";

const STORAGE_KEY = "hapark_theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialTheme = "light",
}: {
  children: React.ReactNode;
  initialTheme?: Theme;
}) {
  const [theme, setTheme] = React.useState<Theme>(initialTheme);

  // 마운트 시 저장된 선호를 반영한다(없으면 기본값 유지).
  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  // theme이 바뀌면 <html data-theme>만 갱신하고 선호를 저장한다.
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // 저장 실패는 무시(프라이빗 모드 등) — UI 동작에는 영향 없음.
    }
  }, [theme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme((t) => (t === "light" ? "dark" : "light")),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme는 ThemeProvider 안에서만 사용할 수 있어요.");
  return ctx;
}
