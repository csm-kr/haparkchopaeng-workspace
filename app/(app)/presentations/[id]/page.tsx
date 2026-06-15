import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import {
  CommentThread,
  DeletePresentationButton,
  PresentationViewer,
  type MemberRef,
} from "@/components/presentations";
import { getSession } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import {
  getMemberRefs,
  getPresentationDetail,
} from "@/lib/presentations";
import { prisma } from "@/lib/prisma";
import { addComment, toggleReaction } from "./actions";

// 발표 자료 상세 — RSC. 읽기는 서버에서 Prisma 직접(ADR-015/R32).
// 자료 뷰어(순수) + 회고 댓글 스레드(클라이언트 섬). 댓글은 발표 자료에 귀속(ADR-004).
// 댓글/반응 쓰기는 Server Action(actions.ts)으로 위임한다.

interface PageProps {
  params: Promise<{ id: string }>;
}

function metaLine(parts: Array<string | number | null | undefined>): string {
  return parts.filter((p) => p != null && p !== "").join(" · ");
}

export default async function PresentationDetailPage({ params }: PageProps) {
  const { id } = await params;

  // CRITICAL: 활성 팀으로 스코핑(R37/R19) — 다른 팀 자료면 detail=null → "없음" UI(404 등가).
  const session = await getSession();
  if (!session) redirect("/");
  const team = await getActiveTeam(session.memberId);
  if (!team) redirect("/teams/new");

  let detail: Awaited<ReturnType<typeof getPresentationDetail>> = null;
  let members: MemberRef[] = [];
  let failed = false;
  try {
    [detail, members] = await Promise.all([
      getPresentationDetail(id, team.id),
      getMemberRefs(),
    ]);
  } catch {
    failed = true;
  }

  // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
  if (failed) {
    return (
      <>
        <Topbar
          crumbs={[{ label: "발표 자료", href: "/presentations" }, { label: "오류" }]}
        />
        <div className="flex-1 overflow-y-auto p-6">
          <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-[15px] font-semibold text-fg">
              발표 자료를 불러오지 못했어요.
            </p>
            <p className="max-w-sm text-[13px] text-fg-muted">
              잠깐 후 다시 시도해주세요.
            </p>
            <Link
              href={`/presentations/${id}`}
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
        <Topbar
          crumbs={[{ label: "발표 자료", href: "/presentations" }, { label: "없음" }]}
        />
        <div className="flex-1 overflow-y-auto p-6">
          <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-[15px] font-semibold text-fg">
              발표 자료를 찾을 수 없어요.
            </p>
            <Link
              href="/presentations"
              className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
            >
              발표 자료 목록으로
            </Link>
          </Card>
        </div>
      </>
    );
  }

  const { presentation } = detail;

  // 작성자 표기에 쓸 현재 사용자(낙관적 추가 시 표시). 인증은 위에서 보장(session).
  const meRow = session
    ? await prisma.member.findUnique({
        where: { id: session.memberId },
        select: { id: true, name: true, handle: true, initial: true, color: true },
      })
    : null;
  const currentUser: MemberRef = meRow ?? {
    id: "unknown",
    name: "나",
    handle: "@me",
    initial: "나",
    color: "var(--m-ha)",
  };

  // 삭제 노출: 발표자(작성자)만(서버가 최종 강제, R3).
  const canDelete =
    !!session && presentation.presenterId === session.memberId;

  return (
    <>
      <Topbar
        crumbs={[
          { label: "발표 자료", href: "/presentations" },
          { label: presentation.title },
        ]}
        actions={
          canDelete ? (
            <DeletePresentationButton
              presentationId={presentation.id}
              title={presentation.title}
            />
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
          <header className="flex flex-col gap-1.5">
            <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-fg">
              {presentation.title}
            </h1>
            <p className="text-[12px] text-fg-subtle">
              {metaLine([
                presentation.presenter?.name,
                presentation.duration,
                `슬라이드 ${presentation.slideCount}장`,
              ])}
            </p>
          </header>

          <PresentationViewer
            presentation={presentation}
            assets={detail.assets}
            versions={detail.versions}
          />

          <CommentThread
            presentationId={presentation.id}
            comments={detail.comments}
            members={members}
            currentUser={currentUser}
            addComment={addComment}
            toggleReaction={toggleReaction}
          />
        </div>
      </div>
    </>
  );
}
