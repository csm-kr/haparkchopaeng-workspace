import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { getMembership } from "@/lib/teams";
import { prisma } from "@/lib/prisma";

// PATCH/DELETE /api/teams/:slug/members/:memberId — 멤버십 역할 변경 / 내보내기(ADR-018).
// CRITICAL: 권한은 RLS 없이 앱레벨에서 멤버십 역할로 강제(R19). UI 게이팅은 보조 — 서버가 최종.
// CRITICAL: owner는 강등·추방 불가(팀당 owner ≥ 1). role에 owner 부여 금지(초대로도 불가, ADR-018).

const PatchSchema = z.object({ role: z.enum(["admin", "member"]) }); // owner 부여 불가

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string; memberId: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { slug, memberId } = await params;

    const team = await prisma.team.findUnique({ where: { slug } });
    if (!team) return fail(404, "NOT_FOUND", "팀을 찾을 수 없어요.");

    // 역할 변경은 owner만(R19).
    const viewer = await getMembership(team.id, session.memberId);
    if (viewer?.role !== "owner") {
      return fail(403, "FORBIDDEN", "역할 변경은 owner만 할 수 있어요.");
    }

    const body: unknown = await req.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) return fail(400, "BAD_REQUEST", "역할을 확인해주세요.");

    const target = await getMembership(team.id, memberId);
    if (!target) return fail(404, "NOT_FOUND", "멤버를 찾을 수 없어요.");
    if (target.role === "owner") {
      return fail(403, "FORBIDDEN", "owner의 역할은 바꿀 수 없어요.");
    }

    const updated = await prisma.membership.update({
      where: { teamId_memberId: { teamId: team.id, memberId } },
      data: { role: parsed.data.role },
    });
    return ok({ memberId, role: updated.role });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; memberId: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { slug, memberId } = await params;

    const team = await prisma.team.findUnique({ where: { slug } });
    if (!team) return fail(404, "NOT_FOUND", "팀을 찾을 수 없어요.");

    const target = await getMembership(team.id, memberId);
    if (!target) return fail(404, "NOT_FOUND", "멤버를 찾을 수 없어요.");

    // owner는 이 경로로 제거하지 않는다 — 팀당 owner ≥ 1, 강등·추방 불가. 양도는 범위 밖.
    if (target.role === "owner") {
      return fail(403, "FORBIDDEN", "owner는 내보낼 수 없어요.");
    }

    const isSelf = memberId === session.memberId;
    const viewer = isSelf ? target : await getMembership(team.id, session.memberId);
    if (!viewer) return fail(403, "FORBIDDEN", "이 작업의 권한이 없어요.");

    // 본인 탈퇴(비-owner) · owner가 비-owner 제거 · admin이 member 제거.
    const allowed =
      isSelf ||
      viewer.role === "owner" ||
      (viewer.role === "admin" && target.role === "member");
    if (!allowed) return fail(403, "FORBIDDEN", "이 멤버를 내보낼 권한이 없어요.");

    await prisma.membership.delete({
      where: { teamId_memberId: { teamId: team.id, memberId } },
    });
    return ok({ memberId });
  } catch (e) {
    return toErrorResponse(e);
  }
}
