import { prisma } from "@/lib/prisma";
import type { AssetType } from "@/types";
import type {
  AssetView,
  CommentView,
  MemberRef,
  PresentationDetailView,
  PresentationListItem,
  ReactionView,
  SlideView,
  VersionView,
} from "@/components/presentations";

// 발표 자료 서버 조회 — 읽기는 RSC에서 Prisma 직접(ADR-015/R32).
// 클라이언트는 이 데이터를 fetch하지 않는다. 댓글은 발표 자료에 귀속된다(ADR-004).

/** Json 컬럼을 string[]로 안전하게 좁힌다. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Json(slides)을 Slide[]로 안전하게 좁힌다. 형태가 어긋난 항목은 버린다. */
function toSlides(value: unknown): SlideView[] {
  if (!Array.isArray(value)) return [];
  const slides: SlideView[] = [];
  for (const s of value) {
    if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      if (typeof o.title === "string" && typeof o.body === "string") {
        slides.push({
          title: o.title,
          subtitle: typeof o.subtitle === "string" ? o.subtitle : null,
          body: o.body,
        });
      }
    }
  }
  return slides;
}

/** DB의 PresentationAsset.type(String)을 유니온으로 좁힌다. */
function toAssetType(value: string): AssetType {
  return value === "ppt" || value === "note" ? value : "pdf";
}

interface MemberRow {
  id: string;
  name: string;
  handle: string;
  initial: string;
  color: string;
}

function toRef(m: MemberRow | undefined): MemberRef | null {
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    handle: m.handle,
    initial: m.initial,
    color: m.color,
  };
}

export async function getPresentations(
  teamId: string,
): Promise<PresentationListItem[]> {
  // 발표 자료 + 발표자(Member)를 함께 읽는다. presenterId는 Member.id이지만
  // 스키마에 관계가 없어 멤버를 한 번에 조회해 맵으로 합친다(getPapers와 동일 패턴).
  // CRITICAL: 활성 팀으로 스코핑(R37/ADR-020). 멤버는 전역(스코핑 대상 아님).
  const [presentations, members] = await Promise.all([
    prisma.presentation.findMany({
      where: { teamId },
      orderBy: { date: "desc" },
      select: {
        id: true,
        title: true,
        presenterId: true,
        date: true,
        duration: true,
        slideCount: true,
        tags: true,
      },
    }),
    prisma.member.findMany({
      select: { id: true, name: true, handle: true, initial: true, color: true },
    }),
  ]);

  const byId = new Map<string, MemberRow>(members.map((m) => [m.id, m]));

  return presentations.map((p) => ({
    id: p.id,
    title: p.title,
    date: p.date.toISOString(),
    duration: p.duration,
    slideCount: p.slideCount,
    tags: toStringArray(p.tags),
    presenter: toRef(byId.get(p.presenterId)),
  }));
}

export async function getPresentationDetail(
  id: string,
  teamId: string,
): Promise<PresentationDetailView | null> {
  // 발표 자료 + 에셋 + 버전 + 댓글(반응 포함)을 함께 읽는다(ADR-015/R32).
  // CRITICAL: 활성 팀 일치 확인(R37/R19) — 다른 팀 자료면 null(존재 숨김 → 404). findUnique→findFirst.
  const pres = await prisma.presentation.findFirst({
    where: { id, teamId },
    include: {
      assets: true,
      versions: { orderBy: { createdAt: "desc" } },
      comments: {
        orderBy: { createdAt: "asc" }, // 회고 스레드는 시간순(SCREENS)
        include: { reactions: true },
      },
    },
  });
  if (!pres) return null;

  // 작성자/발표자(Member)는 관계가 없어 맵으로 합친다.
  const members = await prisma.member.findMany({
    select: { id: true, name: true, handle: true, initial: true, color: true },
  });
  const byId = new Map<string, MemberRow>(members.map((m) => [m.id, m]));

  const assets: AssetView[] = pres.assets.map((a) => ({
    id: a.id,
    name: a.name,
    type: toAssetType(a.type),
    size: a.size,
    url: a.url,
  }));

  const versions: VersionView[] = pres.versions.map((v) => ({
    id: v.id,
    ver: v.ver,
    note: v.note,
    createdAt: v.createdAt.toISOString(),
    by: toRef(byId.get(v.byId)),
  }));

  const comments: CommentView[] = pres.comments.map((c) => ({
    id: c.id,
    body: c.body,
    slide: c.slide,
    createdAt: c.createdAt.toISOString(),
    author: toRef(byId.get(c.authorId)),
    reactions: c.reactions.map(
      (r): ReactionView => ({
        id: r.id,
        emoji: r.emoji,
        member: toRef(byId.get(r.memberId)),
      }),
    ),
  }));

  return {
    presentation: {
      id: pres.id,
      title: pres.title,
      presenterId: pres.presenterId,
      presenter: toRef(byId.get(pres.presenterId)),
      date: pres.date.toISOString(),
      duration: pres.duration,
      slideCount: pres.slideCount,
      tags: toStringArray(pres.tags),
      summary: pres.summary,
      keypoints: toStringArray(pres.keypoints),
      slides: toSlides(pres.slides),
    },
    assets,
    versions,
    comments,
  };
}

/** 멘션 해소·반응 식별에 쓸 전체 멤버 목록(클라이언트 섬에 전달). */
export async function getMemberRefs(): Promise<MemberRef[]> {
  const members = await prisma.member.findMany({
    select: { id: true, name: true, handle: true, initial: true, color: true },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({
    id: m.id,
    name: m.name,
    handle: m.handle,
    initial: m.initial,
    color: m.color,
  }));
}
