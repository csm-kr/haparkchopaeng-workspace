import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 정직한 빈 상태 (R21): 아이콘 + 제목 + (선택) 설명 + CTA 하나.
 * 가짜 데이터로 채우지 않는다.
 */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** 명확한 행동 하나 (예: <Button>첫 PDF 올리기</Button>) */
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent"
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold text-fg">{title}</p>
        {description && (
          <p className="max-w-sm text-[13px] text-fg-muted">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
