import { BookText, Calendar, Home, Play, Users, Video } from "lucide-react";

// 사이드바 내비 — SCREENS.md §영속 셸의 순서:
// 홈 · 논문 · 발표 자료 · 스케쥴 · 팀 관리 · 세미나 라이브.
// `live: true` 항목(meeting)은 live===true일 때만 LIVE 알약을 띄운다(이때 count 억제).

export interface NavItem {
  id: string;
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  count?: number;
  live?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", href: "/dashboard", label: "홈", Icon: Home },
  { id: "library", href: "/library", label: "논문", Icon: BookText },
  { id: "presentations", href: "/presentations", label: "발표 자료", Icon: Play },
  { id: "schedule", href: "/schedule", label: "스케쥴", Icon: Calendar },
  { id: "team", href: "/team", label: "팀 관리", Icon: Users },
  {
    id: "meeting",
    href: "/meeting",
    label: "세미나 라이브",
    Icon: Video,
    live: true,
  },
];
