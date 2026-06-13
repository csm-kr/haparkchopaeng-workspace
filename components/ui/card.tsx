import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** hover 시 border-strong + shadow-sm (DESIGN_GUIDE §카드) */
  hoverable?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, hoverable = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden rounded-lg border border-border-token bg-bg-elevated transition-[border-color,box-shadow]",
        hoverable &&
          "cursor-pointer hover:border-border-strong hover:shadow-[var(--shadow-sm)]",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";
