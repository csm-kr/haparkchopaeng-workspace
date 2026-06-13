import Link from "next/link";
import { BookText, FileText } from "lucide-react";
import { Avatar, Badge, Card, EmptyState } from "@/components/ui";
import type { AnalysisStatus } from "@/types";

// 논문 목록 — 단일 필터 칩 "전체"만(R17/ADR-007: 타입 필터 추가 금지).
// 행: 종류 태그·제목·저자·업로더 아바타·날짜 → 클릭 시 /papers/:id(상세는 다음 step, 링크만).
// 데이터는 RSC(page)에서 props로 내려온다(ADR-015). 토큰만 사용(R20).

export interface PaperUploader {
  name: string;
  initial: string;
  /** 멤버 색 토큰값 (예: "var(--m-ha)") */
  color: string;
}

export interface PaperListItem {
  id: string;
  title: string;
  authors: string;
  /** 종류 태그(tags 첫 항목). 없으면 null */
  tag: string | null;
  analysisStatus: AnalysisStatus;
  uploadedAt: string;
  uploader: PaperUploader | null;
}

export interface PaperListProps {
  papers: PaperListItem[];
}

/** ISO 8601 → "YYYY.MM.DD" (locale/timezone에 흔들리지 않게 문자열 슬라이스). */
function ymd(iso: string): string {
  return iso.slice(0, 10).replaceAll("-", ".");
}

/** 분석 상태가 ready가 아니면 가벼운 표시(SCREENS §화면별 상태). */
function statusLabel(status: AnalysisStatus): string | null {
  if (status === "pending") return "분석 중";
  if (status === "failed") return "분석 실패";
  return null;
}

export function PaperList({ papers }: PaperListProps) {
  // 정직한 빈 상태 + 명확한 CTA 하나(R21/R26). 업로드 모달은 이후 step.
  if (papers.length === 0) {
    return (
      <EmptyState
        icon={<BookText size={20} />}
        title="아직 올라온 논문이 없어요"
        description="첫 PDF를 올리면 두 관점 분석으로 바뀌어요."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 단일 필터 칩 — "전체" 하나만. 다른 타입 필터를 추가하지 않는다(R17). */}
      <div className="flex items-center gap-2">
        <span
          aria-current="true"
          className="rounded-[10px] bg-accent-soft px-3 py-1 text-[12px] font-medium text-accent"
        >
          전체
        </span>
      </div>

      <Card>
        <ul className="divide-y divide-border-token">
          {papers.map((p) => {
            const label = statusLabel(p.analysisStatus);
            return (
              <li key={p.id}>
                <Link
                  href={`/papers/${p.id}`}
                  className="paper-row flex items-center gap-3 px-4 py-3 hover:bg-bg-hover"
                >
                  {p.tag && (
                    <Badge className="shrink-0 bg-bg-subtle text-fg-muted">
                      {p.tag}
                    </Badge>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-fg">
                        {p.title}
                      </span>
                      {label && (
                        <span className="shrink-0 text-[11px] text-fg-subtle">
                          {label}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-[12px] text-fg-subtle">
                      {p.authors}
                    </span>
                  </span>
                  {p.uploader ? (
                    <Avatar user={p.uploader} size="sm" className="shrink-0" />
                  ) : (
                    <FileText
                      size={16}
                      className="shrink-0 text-fg-faint"
                      aria-hidden="true"
                    />
                  )}
                  <span className="shrink-0 font-mono text-[11px] text-fg-faint">
                    {ymd(p.uploadedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
