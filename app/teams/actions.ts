"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createTeam, deleteTeam, isTeamOwner } from "@/lib/teams";

// 팀 생성 Server Action (쓰기 = Server Action, ADR-015/R32). 팀 허브(ADR-021)가 소유한다.
// CRITICAL: creatorId는 클라 입력이 아니라 세션에서 취한다(R3). 결과는 판별 유니온으로 돌려 UI가 인라인 처리(R30).
// CRITICAL: 전역 상한(TEAM_LIMIT)은 createTeam이 서버에서 재강제한다 — UI의 canCreate는 가시화일 뿐.

export type CreateTeamResult =
  | { ok: true; slug: string }
  | { ok: false; code: string; message: string };

const CreateTeamSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
});

export async function createTeamAction(input: {
  name: string;
  slug?: string;
}): Promise<CreateTeamResult> {
  let session;
  try {
    session = await requireAuth();
  } catch {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요해요." };
  }

  const parsed = CreateTeamSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", message: "팀 이름을 확인해주세요." };
  }

  try {
    const { slug } = await createTeam({
      name: parsed.data.name,
      slug: parsed.data.slug,
      creatorId: session.memberId, // 세션에서 — 클라가 보낸 값 미신뢰(R3)
    });
    return { ok: true, slug };
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

// 팀 삭제 Server Action (쓰기 = Server Action, ADR-015/R32). 팀 허브(ADR-021)가 소유한다.
// CRITICAL: 권한은 진입부에서 강제(R19) — 전역 관리자(role==="관리자")는 아무 팀이나, 그 외엔 그 팀 owner만.
// 식별자·역할은 세션에서(R3). 파괴는 deleteTeam이 트랜잭션 cascade로 수행. 결과는 판별 유니온(R30).
export type DeleteTeamResult = { ok: true } | { ok: false; code: string; message: string };

export async function deleteTeamAction(slug: string): Promise<DeleteTeamResult> {
  let session;
  try {
    session = await requireAuth();
  } catch {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요해요." };
  }

  const team = await prisma.team.findUnique({ where: { slug } });
  if (!team) return { ok: false, code: "NOT_FOUND", message: "팀을 찾을 수 없어요." };

  const allowed = session.role === "관리자" || (await isTeamOwner(team.id, session.memberId));
  if (!allowed) return { ok: false, code: "FORBIDDEN", message: "팀을 삭제할 권한이 없어요." };

  await deleteTeam(team.id);
  revalidatePath("/teams");
  return { ok: true };
}
