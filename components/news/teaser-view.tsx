import { Newspaper } from "lucide-react";
import { Card, DeleteMenu } from "@/components/ui";
import type { AuthorSegment, PublicationLink } from "@/lib/news";
import { AuthorLine } from "./author-line";
import { PublicationFormButton } from "./publication-form";

// NEWS 티저 상세 — 대표 이미지로 "그 논문을 보여주는" 쇼케이스 본문.
// 데이터·서명 URL(teaserUrl)은 상세 RSC가 props로 주입한다(ADR-015). 여기선 그릴 뿐.
// canEdit이면 편집(폼 모달)·삭제(확인 메뉴, R27)를 노출 — 권한은 서버가 최종 강제(R19).

export interface TeaserPublication {
  id: string;
  title: string;
  authorSegments: AuthorSegment[];
  venue: string;
  year: number;
  month: number | null;
  links: PublicationLink[];
  teaserUrl: string | null;
}

export interface TeaserViewProps {
  publication: TeaserPublication;
  /** 모든 팀원 true(현 정책) — 편집/삭제 노출 여부 */
  canEdit: boolean;
}

function periodLabel(year: number, month: number | null): string {
  return month != null ? `${year}.${String(month).padStart(2, "0")}` : `${year}`;
}

export function TeaserView({ publication: p, canEdit }: TeaserViewProps) {
  return (
    <article className="flex flex-col gap-5">
      {/* 대표 티저 이미지 — 없으면 플레이스홀더 */}
      <Card className="overflow-hidden">
        <div className="aspect-[16/9] w-full bg-bg-subtle">
          {p.teaserUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.teaserUrl}
              alt={p.title}
              className="size-full object-contain"
            />
          ) : (
            <div
              data-testid="teaser-placeholder"
              aria-hidden="true"
              className="grid size-full place-items-center text-fg-faint"
            >
              <Newspaper size={40} />
            </div>
          )}
        </div>
      </Card>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-fg">
            {p.title}
          </h1>
          <p className="flex items-center gap-1.5 text-[14px] text-fg-muted">
            <span>{p.venue}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{periodLabel(p.year, p.month)}</span>
          </p>
          <AuthorLine
            segments={p.authorSegments}
            className="text-[13px] text-fg-muted"
          />
        </div>

        {canEdit && (
          <div className="flex shrink-0 items-center gap-2">
            <PublicationFormButton
              initial={{
                id: p.id,
                title: p.title,
                venue: p.venue,
                authors: p.authorSegments.map((s) => s.text).join(", "),
                year: p.year,
                month: p.month,
                links: p.links,
                teaserUrl: p.teaserUrl,
              }}
            >
              실적 편집
            </PublicationFormButton>
            <DeleteMenu
              endpoint={`/api/news/${p.id}`}
              redirectTo="/news"
              title={p.title}
              cascadeNote="티저 이미지도 함께 지워져요."
            />
          </div>
        )}
      </div>

      {/* 외부 링크 — 버튼 스타일 앵커(새 탭). 토큰만 사용(R20). */}
      {p.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {p.links.map((l, i) => (
            <a
              key={i}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm border border-border-strong bg-bg-elevated px-2.5 py-1 text-xs font-medium text-fg hover:bg-bg-subtle"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}
