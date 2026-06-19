import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { removeObject } from "@/lib/storage";

// PATCH / DELETE /api/news/:id — 팀 출판 실적 수정·삭제.
// CRITICAL: 활성 팀으로 스코핑(R37/ADR-020) — 다른 팀 실적은 404(존재 숨김, R19).
// CRITICAL: teamId·createdBy는 변경 불가(서버 주입값) — 클라 입력 미신뢰(R3).
// CRITICAL: teaserImage는 news/ 접두만 허용(임의 객체 경로 참조 차단, R36).

const Link = z.object({
  label: z.string().trim().min(1),
  url: z.string().trim().url(),
});

// 부분 수정 — 모든 필드 optional. teamId/createdBy는 받지 않는다(불변·서버 주입값).
const PatchBody = z.object({
  title: z.string().trim().min(1).optional(),
  venue: z.string().trim().min(1).optional(),
  authors: z.string().trim().min(1).optional(),
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
  teaserImage: z.string().regex(/^news\//).optional(),
  links: z.array(Link).optional(),
});

/** 활성 팀의 실적만 조회한다 — 다른 팀 id면 null → 404(존재 숨김, R19/R37). */
async function findScoped(memberId: string, id: string) {
  const team = await getActiveTeam(memberId);
  if (!team) return null;
  return prisma.publication.findFirst({ where: { id, teamId: team.id } });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const pub = await findScoped(session.memberId, id);
    if (!pub) return fail(404, "NOT_FOUND", "실적을 찾을 수 없어요.");

    const body: unknown = await req.json().catch(() => null);
    const parsed = PatchBody.safeParse(body);
    if (!parsed.success) {
      return fail(400, "BAD_REQUEST", "실적 정보를 확인해주세요.");
    }

    // 보낸 필드만 갱신한다 — undefined는 Prisma가 무시. teamId/createdBy는 애초에 없다(불변).
    const updated = await prisma.publication.update({
      where: { id },
      data: {
        title: parsed.data.title,
        venue: parsed.data.venue,
        authors: parsed.data.authors,
        year: parsed.data.year,
        month: parsed.data.month,
        teaserImage: parsed.data.teaserImage,
        links: parsed.data.links,
      },
    });
    return ok({ id: updated.id });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const pub = await findScoped(session.memberId, id);
    if (!pub) return fail(404, "NOT_FOUND", "실적을 찾을 수 없어요.");

    await prisma.publication.delete({ where: { id } });
    // 티저 이미지 정리는 best-effort — 실패해도 삭제 성공을 막지 않는다(removeObject 정책, R36).
    if (pub.teaserImage) await removeObject(pub.teaserImage);

    return ok({ id });
  } catch (e) {
    return toErrorResponse(e);
  }
}
