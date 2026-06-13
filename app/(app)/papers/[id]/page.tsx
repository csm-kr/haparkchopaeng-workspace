import Link from "next/link";
import { Download } from "lucide-react";
import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import { AnalysisView, DeletePaperButton } from "@/components/analyzer";
import { getSession } from "@/lib/auth";
import { getPaperDetail } from "@/lib/papers";
import { prisma } from "@/lib/prisma";
import { addNote, deleteNote } from "./actions";

// 논문 상세 — RSC. 읽기는 서버에서 Prisma 직접(ADR-015/R32).
// CRITICAL: 상단바 액션은 원문 PDF 다운로드 하나뿐(arXiv/공유 금지, R13).
// CRITICAL: 탭/사이드패널 없음 — 두 관점 토글이 페이지다(ADR-004/R9).
// 노트 쓰기는 Server Action(actions.ts)으로 위임한다.

interface PageProps {
  params: Promise<{ id: string }>;
}

function metaLine(parts: Array<string | number | null | undefined>): string {
  return parts.filter((p) => p != null && p !== "").join(" · ");
}

export default async function PaperDetailPage({ params }: PageProps) {
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof getPaperDetail>> = null;
  let failed = false;
  try {
    detail = await getPaperDetail(id);
  } catch {
    failed = true;
  }

  // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
  if (failed) {
    return (
      <>
        <Topbar crumbs={[{ label: "논문", href: "/library" }, { label: "오류" }]} />
        <div className="flex-1 overflow-y-auto p-6">
          <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-[15px] font-semibold text-fg">
              논문을 불러오지 못했어요.
            </p>
            <p className="max-w-sm text-[13px] text-fg-muted">
              잠깐 후 다시 시도해주세요.
            </p>
            <Link
              href={`/papers/${id}`}
              className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
            >
              다시 시도
            </Link>
          </Card>
        </div>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <Topbar crumbs={[{ label: "논문", href: "/library" }, { label: "없음" }]} />
        <div className="flex-1 overflow-y-auto p-6">
          <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-[15px] font-semibold text-fg">
              논문을 찾을 수 없어요.
            </p>
            <Link
              href="/library"
              className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
            >
              논문 목록으로
            </Link>
          </Card>
        </div>
      </>
    );
  }

  const { paper } = detail;

  // 작성자 표기에 쓸 현재 사용자(노트 낙관적 추가 시 표시). 인증은 (app)/layout이 보장.
  const session = await getSession();
  const me = session
    ? await prisma.member.findUnique({
        where: { id: session.memberId },
        select: { id: true, name: true, initial: true, color: true },
      })
    : null;
  const currentUser = me ?? {
    id: "unknown",
    name: "나",
    initial: "나",
    color: "var(--m-ha)",
  };

  // 삭제 노출: 올린 사람 또는 관리자만(서버가 최종 강제, R3).
  const canDelete =
    !!session &&
    (paper.uploadedBy === session.memberId || session.role === "관리자");

  return (
    <>
      <Topbar
        crumbs={[{ label: "논문", href: "/library" }, { label: paper.title }]}
        actions={
          // R13: 주 액션은 원문 PDF 다운로드. 삭제는 작성자/관리자에게만 보이는 보조 액션(R27).
          // 비공개 버킷 → 서명 URL 리디렉트 라우트로 받는다(R36).
          <div className="flex items-center gap-2">
            <a
              href={`/api/papers/${paper.id}/pdf`}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border-strong bg-bg-elevated px-3.5 py-[7px] text-[13px] font-medium text-fg hover:bg-bg-subtle"
            >
              <Download size={14} aria-hidden="true" />
              원문 PDF
            </a>
            {canDelete && (
              <DeletePaperButton paperId={paper.id} title={paper.title} />
            )}
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
          <header className="flex flex-col gap-1.5">
            <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-fg">
              {paper.title}
            </h1>
            <p className="text-[13px] text-fg-muted">{paper.authors}</p>
            <p className="text-[12px] text-fg-subtle">
              {metaLine([
                paper.venue,
                paper.year,
                paper.pageCount ? `${paper.pageCount}p` : null,
                paper.arxiv ? `arXiv:${paper.arxiv}` : null,
              ])}
            </p>
          </header>

          <AnalysisView
            paperId={paper.id}
            analysisStatus={paper.analysisStatus}
            research={detail.research}
            repro={detail.repro}
            figures={detail.figures}
            notes={detail.notes}
            currentUser={currentUser}
            addNote={addNote}
            deleteNote={deleteNote}
          />
        </div>
      </div>
    </>
  );
}
