import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "w-full rounded-sm border border-border-strong bg-bg-elevated px-3 py-[9px] text-sm text-fg",
        "transition-[border-color,box-shadow] outline-none placeholder:text-fg-faint",
        "focus:border-accent focus:ring-[3px] focus:ring-accent-soft",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
