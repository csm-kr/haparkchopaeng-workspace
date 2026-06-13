import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// 상단바 — 좌측 브레드크럼 + 우측 맥락 액션 슬롯. 모든 화면이 <Topbar crumbs actions />.
// 상호작용 상태가 없으므로 RSC로 둔다(actions로 받는 섬만 클라이언트).

export interface Crumb {
  label: string;
  href?: string;
}

export interface TopbarProps {
  crumbs: Crumb[];
  actions?: React.ReactNode;
}

export function Topbar({ crumbs, actions }: TopbarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-token bg-bg px-6">
      <nav aria-label="브레드크럼" className="flex items-center gap-1.5 text-[13px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <React.Fragment key={`${c.label}-${i}`}>
              {i > 0 && (
                <ChevronRight
                  size={12}
                  className="text-fg-faint"
                  aria-hidden="true"
                />
              )}
              {c.href && !last ? (
                <Link href={c.href} className="text-fg-muted hover:text-fg">
                  {c.label}
                </Link>
              ) : (
                <span
                  className={cn(last ? "font-medium text-fg" : "text-fg-muted")}
                >
                  {c.label}
                </span>
              )}
            </React.Fragment>
          );
        })}
      </nav>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
