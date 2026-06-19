import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import { TeaserView, type TeaserPublication } from "@/components/news";
import { getPublication, splitAuthors } from "@/lib/news";
import { signedDownloadUrl } from "@/lib/storage";
import { getSession } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { prisma } from "@/lib/prisma";

// NEWS 티저 상세 — 대표 이미지로 "그 논문을 보여주는" 쇼케이스 RSC. 읽기는 서버에서 Prisma 직접(ADR-015/R32).
// 티저 이미지는 단기 서명 URL로만(R36). 편집/삭제는 모든 팀원(canEdit=true) — 권한은 서버가 최종 강제(R19).
// CRITICAL: 활성 팀으로 스코핑(R37/R19) — 다른 팀·없는 id면 notFound()(404 등가, 존재 숨김).

interface PageProps {
  params: Promise<{ id: string }>;
}

/** 티저 객체 키를 단기 서명 URL로(R36). 서명 실패는 null 폴백 — 화면을 깨지 않는다. */
async function resolveTeaserUrl(
  teaserImage: string | null,
): Promise<string | null> {
  if (!teaserImage) return null;
  try {
    return await signedDownloadUrl(teaserImage);
  } catch {
    return null;
  }
}

export default async function NewsDetailPage({ params }: PageProps) {
  const { id } = await params;

  const session = await getSession();
  if (!session) redirect("/");
  const team = await getActiveTeam(session.memberId);
  if (!team) redirect("/teams");

  let pub: Awaited<ReturnType<typeof getPublication>> = null;
  let memberNames: string[] = [];
  let failed = false;
  try {
    const [p, members] = await Promise.all([
      getPublication(team.id, id),
      prisma.member.findMany({ select: { name: true } }),
    ]);
    pub = p;
    memberNames = members.map((m) => m.name);
  } catch {
    failed = true;
  }

  // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
  if (failed) {
    return (
      <>
        <Topbar crumbs={[{ label: "NEWS", href: "/news" }, { label: "오류" }]} />
        <div className="flex-1 overflow-y-auto p-6">
          <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-[15px] font-semibold text-fg">
              실적을 불러오지 못했어요.
            </p>
            <p className="max-w-sm text-[13px] text-fg-muted">
              잠깐 후 다시 시도해주세요.
            </p>
            <Link
              href={`/news/${id}`}
              className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
            >
              다시 시도
            </Link>
          </Card>
        </div>
      </>
    );
  }

  // 없거나 다른 팀이면 404(존재 숨김, R19/R37).
  if (!pub) notFound();

  const teaserUrl = await resolveTeaserUrl(pub.teaserImage);
  const publication: TeaserPublication = {
    id: pub.id,
    title: pub.title,
    authorSegments: splitAuthors(pub.authors, memberNames),
    venue: pub.venue,
    year: pub.year,
    month: pub.month,
    links: pub.links,
    teaserUrl,
  };

  return (
    <>
      <Topbar
        crumbs={[{ label: "NEWS", href: "/news" }, { label: pub.title }]}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
          <TeaserView publication={publication} canEdit />
        </div>
      </div>
    </>
  );
}
