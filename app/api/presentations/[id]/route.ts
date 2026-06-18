import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const MAX_TITLE = 200; // 제목 최대 길이(긴 이름은 표시단에서도 truncate). 초과 입력은 거부.
const PatchBody = z.object({ title: z.string() });

// DELETE /api/presentations/:id — 발표 자료 삭제. ✍️ 발표자만(SECURITY).
// CRITICAL: 활성 팀으로 스코핑(R37/ADR-020) — 다른 팀 자료는 404(교차 팀 변이 차단, R19).
// CRITICAL: 권한은 세션에서 — 클라가 보낸 식별자 미신뢰(R3).
// 에셋·버전·댓글(+반응)은 스키마 onDelete:Cascade로 함께 지워진다.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // 활성 팀의 자료만 — 다른 팀 id면 null → 404(존재를 드러내지 않는다, R19).
    const team = await getActiveTeam(session.memberId);
    const pres = team
      ? await prisma.presentation.findFirst({ where: { id, teamId: team.id } })
      : null;
    if (!pres) return fail(404, "NOT_FOUND", "발표 자료를 찾을 수 없어요.");

    // 발표자(작성자)만 삭제할 수 있다(R3). 그 외(관리자 포함) 403.
    if (pres.presenterId !== session.memberId) {
      return fail(403, "FORBIDDEN", "발표자만 삭제할 수 있어요.");
    }

    await prisma.presentation.delete({ where: { id } }); // cascade: 에셋/버전/댓글

    return ok({ id });
  } catch (e) {
    return toErrorResponse(e);
  }
}

// PATCH /api/presentations/:id — 발표 자료 이름(제목) 변경.
// CRITICAL: 활성 팀으로 스코핑(R37/ADR-020) — 다른 팀 자료는 404(존재를 드러내지 않는다, R19).
// 권한: 팀 멤버 누구나 변경 가능(삭제와 달리 발표자 제한 없음) — 활성 팀 일치가 곧 권한.
// 제목만 바꾼다(발표자/메타 불변). trim 후 1~MAX_TITLE자만 허용.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // 활성 팀의 자료만 — 다른 팀 id면 findFirst가 null → 404(존재 숨김, R19).
    const team = await getActiveTeam(session.memberId);
    const pres = team
      ? await prisma.presentation.findFirst({ where: { id, teamId: team.id } })
      : null;
    if (!pres) return fail(404, "NOT_FOUND", "발표 자료를 찾을 수 없어요.");

    const body: unknown = await req.json().catch(() => null);
    const parsed = PatchBody.safeParse(body);
    const title = parsed.success ? parsed.data.title.trim() : "";
    if (!parsed.success || title.length < 1 || title.length > MAX_TITLE) {
      return fail(400, "BAD_REQUEST", `제목은 1~${MAX_TITLE}자로 입력해주세요.`);
    }

    const updated = await prisma.presentation.update({
      where: { id },
      data: { title },
    });
    return ok({ id: updated.id, title: updated.title });
  } catch (e) {
    return toErrorResponse(e);
  }
}
