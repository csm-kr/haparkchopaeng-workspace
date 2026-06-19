import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// POST /api/news — 팀 출판 실적(Publication) 생성.
// CRITICAL: teamId는 활성 팀에서, createdBy는 세션에서 취한다 — 클라 입력 미신뢰(R3/R37).
// CRITICAL: teaserImage는 프리사인이 발급한 news/ 키만 신뢰한다(임의 객체 경로 참조 차단, R36).
// NEWS는 외부 링크만 — 분석/잡(Inngest)과 무관(ADR-022).

const Link = z.object({
  label: z.string().trim().min(1),
  url: z.string().trim().url(),
});

const Body = z.object({
  title: z.string().trim().min(1),
  venue: z.string().trim().min(1),
  authors: z.string().trim().min(1),
  year: z.number().int(),
  month: z.number().int().min(1).max(12).optional(),
  // 프리사인이 발급한 news/ 키만 신뢰한다(다른 객체 참조 방지, R36).
  teaserImage: z.string().regex(/^news\//).optional(),
  links: z.array(Link).default([]),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireAuth();

    // 활성 팀(검증된 멤버십)에서 teamId를 취한다 — 클라 입력 미신뢰(R3/R37). 없으면 403.
    const team = await getActiveTeam(session.memberId);
    if (!team) return fail(403, "FORBIDDEN", "활성 팀이 없어요.");

    const body: unknown = await req.json().catch(() => null);
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      return fail(400, "BAD_REQUEST", "실적 정보를 확인해주세요.");
    }
    const { title, venue, authors, year, month, teaserImage, links } =
      parsed.data;

    const pub = await prisma.publication.create({
      data: {
        teamId: team.id, // R3/R37: 활성 팀에서 주입
        createdBy: session.memberId, // R3: 세션에서 주입
        title,
        venue,
        authors,
        year,
        month: month ?? null,
        teaserImage: teaserImage ?? null,
        links,
      },
      select: { id: true },
    });

    return ok({ id: pub.id }, 201);
  } catch (e) {
    return toErrorResponse(e);
  }
}
