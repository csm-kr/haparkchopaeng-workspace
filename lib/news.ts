import { prisma } from "@/lib/prisma";

// NEWS 출판 실적 서버 조회 — 읽기는 RSC에서 Prisma 직접(ADR-015/R32).
// 클라이언트는 이 데이터를 fetch하지 않는다. NEWS는 분석 대상이 아니다(Paper와 의미 분리, ADR-022).

export interface PublicationLink {
  label: string;
  url: string;
}

export interface PublicationView {
  id: string;
  title: string;
  authors: string;
  venue: string;
  year: number;
  month: number | null;
  teaserImage: string | null;
  links: PublicationLink[];
  createdBy: string;
}

export interface AuthorSegment {
  text: string;
  isMember: boolean;
}

/** Json(links)을 PublicationLink[]로 안전하게 좁힌다. 형태가 어긋난 항목은 버린다. */
function toLinks(value: unknown): PublicationLink[] {
  if (!Array.isArray(value)) return [];
  const links: PublicationLink[] = [];
  for (const l of value) {
    if (l && typeof l === "object") {
      const o = l as Record<string, unknown>;
      if (typeof o.label === "string" && typeof o.url === "string") {
        links.push({ label: o.label, url: o.url });
      }
    }
  }
  return links;
}

interface PublicationRow {
  id: string;
  title: string;
  authors: string;
  venue: string;
  year: number;
  month: number | null;
  teaserImage: string | null;
  links: unknown;
  createdBy: string;
}

function toView(p: PublicationRow): PublicationView {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors,
    venue: p.venue,
    year: p.year,
    month: p.month,
    teaserImage: p.teaserImage,
    links: toLinks(p.links),
    createdBy: p.createdBy,
  };
}

/**
 * 활성 팀의 실적 목록 — year desc, month desc(null은 마지막).
 * CRITICAL: 활성 팀으로 스코핑(R37/ADR-020) — 다른 팀 실적은 절대 섞이지 않는다.
 * Postgres에서 DESC는 NULL을 먼저 정렬하므로, month=null을 마지막으로 코드에서 한 번 더 안정화한다.
 */
export async function getPublications(
  teamId: string,
): Promise<PublicationView[]> {
  const rows = await prisma.publication.findMany({
    where: { teamId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  const sorted = [...rows].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month == null && b.month == null) return 0;
    if (a.month == null) return 1; // null은 마지막
    if (b.month == null) return -1;
    return b.month - a.month;
  });
  return sorted.map(toView);
}

/**
 * 팀 스코프 단건 — 없거나 다른 팀이면 null(존재 숨김 → 404, R19/R37).
 */
export async function getPublication(
  teamId: string,
  id: string,
): Promise<PublicationView | null> {
  const pub = await prisma.publication.findFirst({ where: { id, teamId } });
  if (!pub) return null;
  return toView(pub);
}

/**
 * 자유 텍스트 저자 문자열을 쉼표로 나누고, memberNames에 포함된 이름은 isMember=true로 표시.
 * 동등 비교로 충분(현 4인 규모, 동명이인 무시 — YAGNI). 공백·빈 조각은 버린다.
 */
export function splitAuthors(
  authors: string,
  memberNames: string[],
): AuthorSegment[] {
  const names = new Set(memberNames.map((n) => n.trim()));
  return authors
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((text) => ({ text, isMember: names.has(text) }));
}
