import * as React from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary:
    "bg-bg-elevated text-fg border border-border-strong hover:bg-bg-subtle",
  ghost: "text-fg-muted hover:bg-bg-hover hover:text-fg",
  // 파괴적/위험 액션 — --busy (R27)
  danger: "bg-busy text-accent-fg hover:opacity-90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-[7px] text-[13px]",
  lg: "px-[18px] py-2.5 text-sm",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      data-variant={variant}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap tracking-[-0.01em] transition-colors",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
