import * as React from "react";
import { cn } from "@/lib/utils";

export interface AvatarUser {
  name: string;
  initial: string;
  /** 멤버 색 토큰값 (예: "var(--m-ha)") */
  color: string;
}

export type AvatarSize = "sm" | "md" | "lg" | "xl";

const SIZES: Record<AvatarSize, string> = {
  sm: "size-5 text-[10px]",
  md: "size-6 text-[11px]",
  lg: "size-10 text-base",
  xl: "size-16 text-2xl",
};

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  user: AvatarUser;
  size?: AvatarSize;
}

export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ user, size = "md", className, style, ...props }, ref) => (
    <span
      ref={ref}
      role="img"
      aria-label={`${user.name} 아바타`}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold tracking-[-0.02em] text-white",
        SIZES[size],
        className,
      )}
      style={{ background: user.color, ...style }}
      {...props}
    >
      {user.initial}
    </span>
  ),
);
Avatar.displayName = "Avatar";
