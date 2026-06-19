import Link from "next/link";
import { Newspaper } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import type { AuthorSegment } from "@/lib/news";
import { AuthorLine } from "./author-line";
import { PublicationFormButton } from "./publication-form";

// NEWS 목록 — 우리 팀 출판 실적 카드 그리드. 항목 클릭 → /news/:id.
// 데이터는 RSC(page)에서 props로만 내려온다(ADR-015). 토큰만 사용(R20).
// CRITICAL: DB 조회·서명 URL 해석은 여기서 하지 않는다 — teaserUrl(서명 URL)은 step 4 RSC가 푼다.

export interface PublicationCardData {
  id: string;
  title: string;
  /** 서버가 splitAuthors로 계산해 내려준 저자 세그먼트(팀원 강조용) */
  authorSegments: AuthorSegment[];
  venue: string;
  year: number;
  month: number | null;
  /** 서명 URL(RSC가 해석) 또는 null(플레이스홀더) */
  teaserUrl: string | null;
}

export interface PublicationListProps {
  items: PublicationCardData[];
}

/** month 있으면 "YYYY.MM", 없으면 "YYYY". */
function periodLabel(year: number, month: number | null): string {
  return month != null ? `${year}.${String(month).padStart(2, "0")}` : `${year}`;
}

export function PublicationList({ items }: PublicationListProps) {
  // 정직한 빈 상태 + 명확한 CTA 하나(R21/R26).
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Newspaper size={20} />}
        title="아직 등록된 실적이 없어요"
        description="우리 팀이 발표한 논문을 모아 보여줄 수 있어요."
        action={
          <PublicationFormButton>첫 실적 추가하기</PublicationFormButton>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((p) => (
        <Card key={p.id} hoverable className="flex flex-col">
          <Link href={`/news/${p.id}`} className="flex flex-col">
            {/* 티저 썸네일 — 없으면 플레이스홀더 */}
            <div className="aspect-[16/9] w-full bg-bg-subtle">
              {p.teaserUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.teaserUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="grid size-full place-items-center text-fg-faint"
                >
                  <Newspaper size={28} />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5 px-4 py-3">
              <span className="line-clamp-2 text-[14px] font-semibold text-fg">
                {p.title}
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
                <span>{p.venue}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">
                  {periodLabel(p.year, p.month)}
                </span>
              </span>
              <AuthorLine
                segments={p.authorSegments}
                className="text-[12px] text-fg-muted"
              />
            </div>
          </Link>
        </Card>
      ))}
    </div>
  );
}
