import Link from "next/link";
import { Presentation as PresentationIcon } from "lucide-react";
import { Avatar, Badge, Card, EmptyState } from "@/components/ui";
import type { PresentationListItem } from "./types";

// 발표 자료 목록 — 개수 표시("N개") + 항목 클릭 → /presentations/:id.
// 데이터는 RSC(page)에서 props로 내려온다(ADR-015). 토큰만 사용(R20).

export interface PresentationListProps {
  presentations: PresentationListItem[];
}

/** ISO 8601 → "YYYY.MM.DD" (locale/timezone에 흔들리지 않게 문자열 슬라이스). */
function ymd(iso: string): string {
  return iso.slice(0, 10).replaceAll("-", ".");
}

export function PresentationList({ presentations }: PresentationListProps) {
  // 정직한 빈 상태 + 명확한 CTA 톤(R21/R26).
  if (presentations.length === 0) {
    return (
      <EmptyState
        icon={<PresentationIcon size={20} />}
        title="발표 자료가 아직 없어요"
        description="세미나 발표 자료를 올리면 여기에 쌓여요."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-fg-subtle">{presentations.length}개</p>

      <Card>
        <ul className="divide-y divide-border-token">
          {presentations.map((p) => (
            <li key={p.id}>
              <Link
                href={`/presentations/${p.id}`}
                className="presentation-row flex items-center gap-3 px-4 py-3 hover:bg-bg-hover"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-fg">
                    {p.title}
                  </span>
                  <span className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
                    {p.presenter && (
                      <>
                        <Avatar user={p.presenter} size="sm" />
                        <span>{p.presenter.name}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span>슬라이드 {p.slideCount}장</span>
                    {p.duration && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{p.duration}</span>
                      </>
                    )}
                  </span>
                </span>
                {p.tags[0] && (
                  <Badge className="shrink-0 bg-bg-subtle text-fg-muted">
                    {p.tags[0]}
                  </Badge>
                )}
                <span className="shrink-0 font-mono text-[11px] text-fg-faint">
                  {ymd(p.date)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
