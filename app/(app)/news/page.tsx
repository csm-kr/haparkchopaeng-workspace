import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import {
  PublicationFormButton,
  PublicationList,
  type PublicationCardData,
} from "@/components/news";
import { getPublications, splitAuthors } from "@/lib/news";
import { signedDownloadUrl } from "@/lib/storage";
import { getSession } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { prisma } from "@/lib/prisma";

// NEWS 목록 — 우리 팀 출판 실적 쇼케이스 RSC. 읽기는 서버에서 Prisma 직접(ADR-015/R32, ADR-022).
// 티저 이미지는 단기 서명 URL로만 노출(R36), 저자 강조 세그먼트는 서버가 splitAuthors로 계산해 내려준다.
// 로딩은 loading.tsx(스켈레톤), 빈 상태는 PublicationList 내부, 조회 실패는 인라인 에러 카드(R26/R30).
// CRITICAL: 활성 팀으로 스코핑(R37/ADR-020). 팀 없음은 layout이 처리 — 방어적으로 리다이렉트.

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

export default async function NewsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const team = await getActiveTeam(session.memberId);
  if (!team) redirect("/teams");

  let content: React.ReactNode;
  try {
    const [pubs, members] = await Promise.all([
      getPublications(team.id),
      prisma.member.findMany({ select: { name: true } }),
    ]);
    const memberNames = members.map((m) => m.name);
    const items: PublicationCardData[] = await Promise.all(
      pubs.map(async (p) => ({
        id: p.id,
        title: p.title,
        authorSegments: splitAuthors(p.authors, memberNames),
        venue: p.venue,
        year: p.year,
        month: p.month,
        teaserUrl: await resolveTeaserUrl(p.teaserImage),
      })),
    );
    content = <PublicationList items={items} />;
  } catch {
    // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
    content = (
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-[15px] font-semibold text-fg">
          실적을 불러오지 못했어요.
        </p>
        <p className="max-w-sm text-[13px] text-fg-muted">
          잠깐 후 다시 시도해주세요.
        </p>
        <Link
          href="/news"
          className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
        >
          다시 시도
        </Link>
      </Card>
    );
  }

  return (
    <>
      <Topbar crumbs={[{ label: "NEWS" }]} actions={<PublicationFormButton />} />
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">{content}</div>
      </div>
    </>
  );
}
