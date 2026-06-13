import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 역할(관리자/멤버/게스트)·상태(online/away/busy) 배지.
 * R29: 색에만 의존하지 않는다 — 라벨(children)을 항상 함께 보이고,
 * 상태 배지는 색 점 + 텍스트를 병행한다.
 */
export type BadgeVariant =
  | "admin" // 관리자 — 액센트 틴트
  | "member" // 멤버 — 중립
  | "guest" // 게스트 — 앰버 틴트
  | "online"
  | "away"
  | "busy";

const STATUS: Record<string, string> = {
  online: "var(--online)",
  away: "var(--away)",
  busy: "var(--busy)",
};

const ROLE_CLASS: Record<string, string> = {
  admin: "bg-accent-soft text-accent",
  member: "bg-bg-subtle text-fg-muted",
  // 앰버 틴트 — --away(앰버) 토큰에서 파생(색 하드코딩 없음)
  guest:
    "bg-[color-mix(in_oklch,var(--away)_18%,var(--bg-elevated))] text-[color-mix(in_oklch,var(--away),var(--fg)_38%)]",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "member", children, ...props }, ref) => {
    const isStatus = variant in STATUS;
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[10px] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
          isStatus ? "bg-bg-subtle text-fg-muted" : ROLE_CLASS[variant],
          className,
        )}
        {...props}
      >
        {isStatus && (
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full"
            style={{ background: STATUS[variant] }}
          />
        )}
        {children}
      </span>
    );
  },
);
Badge.displayName = "Badge";
