import Link from "next/link";
import { BookText, Play } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";

// 홈 최근 활동 — 최근 논문·발표 자료. 항목은 해당 상세 라우트로의 링크만 둔다
// (실제 상세 화면은 이후 step). 데이터는 RSC(page)에서 props로 내려온다(ADR-015).

export interface RecentPaper {
  id: string;
  title: string;
  authors: string;
  uploadedAt: string;
}

export interface RecentPresentation {
  id: string;
  title: string;
  date: string;
}

export interface RecentActivityProps {
  recentPapers: RecentPaper[];
  recentPresentations: RecentPresentation[];
}

/** ISO 8601 → "YYYY.MM.DD" (locale/timezone에 흔들리지 않게 문자열 슬라이스). */
function ymd(iso: string): string {
  const date = iso.slice(0, 10); // "2026-06-10"
  return date.replaceAll("-", ".");
}

function ActivityList({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-fg-muted">{title}</h2>
      <Card>
        <ul className="divide-y divide-border-token">{children}</ul>
      </Card>
    </section>
  );
}

export function RecentActivity({
  recentPapers,
  recentPresentations,
}: RecentActivityProps) {
  // 신규 워크스페이스: 정직한 빈 상태 + 명확한 CTA 하나(R21/R26).
  if (recentPapers.length === 0 && recentPresentations.length === 0) {
    return (
      <EmptyState
        icon={<BookText size={20} />}
        title="첫 논문을 올려볼까요?"
        description="PDF를 올리면 두 관점 분석으로 바뀌어요. 리서치는 혼자 하는 게 아니야."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ActivityList title="최근 논문">
        {recentPapers.map((p) => (
          <li key={p.id}>
            <Link
              href={`/papers/${p.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover"
            >
              <BookText size={16} className="shrink-0 text-fg-subtle" aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-fg">
                  {p.title}
                </span>
                <span className="truncate text-[12px] text-fg-subtle">
                  {p.authors}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-fg-faint">
                {ymd(p.uploadedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ActivityList>

      <ActivityList title="최근 발표 자료">
        {recentPresentations.map((pr) => (
          <li key={pr.id}>
            <Link
              href={`/presentations/${pr.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover"
            >
              <Play size={16} className="shrink-0 text-fg-subtle" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                {pr.title}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-fg-faint">
                {ymd(pr.date)}
              </span>
            </Link>
          </li>
        ))}
      </ActivityList>
    </div>
  );
}
