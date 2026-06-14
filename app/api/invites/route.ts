import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { createInvite, inviteLink } from "@/lib/invite";
import { isTeamAdmin } from "@/lib/teams";
import { prisma } from "@/lib/prisma";

// POST /api/invites — 팀 초대 링크 발급. GET /api/invites?teamSlug= — 그 팀 활성 초대 목록.
// CRITICAL: 둘 다 owner·admin만(R19). 권한은 핸들러 진입부에서 멤버십 역할로 강제 — UI 게이팅은 보조.
// CRITICAL: role에 owner 금지(ADR-018). 토큰 발급은 베어러 자격증명 — N인/만료/회수로 완화.

const CreateInvite = z.object({
  teamSlug: z.string().min(1),
  role: z.enum(["admin", "member"]), // owner는 초대 불가(ADR-018)
  maxUses: z.number().int().min(1).max(100).optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireAuth();
    const body: unknown = await req.json().catch(() => null);
    const parsed = CreateInvite.safeParse(body);
    if (!parsed.success) return fail(400, "BAD_REQUEST", "역할과 사용 횟수를 확인해주세요.");

    const team = await prisma.team.findUnique({ where: { slug: parsed.data.teamSlug } });
    if (!team) return fail(404, "NOT_FOUND", "팀을 찾을 수 없어요.");

    if (!(await isTeamAdmin(team.id, session.memberId))) {
      return fail(403, "FORBIDDEN", "초대는 owner·admin만 보낼 수 있어요.");
    }

    // createdBy는 세션에서 취한다 — 클라 입력 미신뢰(R3).
    const invite = await createInvite({
      teamId: team.id,
      role: parsed.data.role,
      maxUses: parsed.data.maxUses,
      createdBy: session.memberId,
    });
    return ok({ invite, link: inviteLink(invite.token) }, 201);
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireAuth();
    const teamSlug = new URL(req.url).searchParams.get("teamSlug");
    if (!teamSlug) return fail(400, "BAD_REQUEST", "팀을 지정해주세요.");

    const team = await prisma.team.findUnique({ where: { slug: teamSlug } });
    if (!team) return fail(404, "NOT_FOUND", "팀을 찾을 수 없어요.");

    if (!(await isTeamAdmin(team.id, session.memberId))) {
      return fail(403, "FORBIDDEN", "초대 목록은 owner·admin만 볼 수 있어요.");
    }

    // 활성 = 회수 안 됨 + 미만료 + 사용 여력 있음(usedCount<maxUses는 컬럼 비교라 JS에서).
    const invites = await prisma.invite.findMany({
      where: { teamId: team.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return ok(invites.filter((i) => i.usedCount < i.maxUses));
  } catch (e) {
    return toErrorResponse(e);
  }
}
