import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 로딩 상태용 스켈레톤 (R26). shimmer로 처리 중을 표현하되,
 * prefers-reduced-motion에서는 정적 표면으로 대체된다(globals.css).
 */
export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("anim-shimmer rounded-sm", className)}
      {...props}
    />
  );
}
