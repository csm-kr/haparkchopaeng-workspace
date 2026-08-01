"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_TEAMS_MAX, MAX_TEAMS_MIN, setMaxTeams } from "@/lib/settings";

// 전역 팀 상한 조절 Server Action (쓰기 = Server Action, ADR-015/R32).
// CRITICAL: Server Action은 페이지와 별개의 진입점이다 — 여기서 권한을 다시 강제한다(R19).
// CRITICAL: 권한 실패도 NOT_FOUND로 돌려준다 — 콘솔의 존재를 노출하지 않는다.
// CRITICAL: updatedBy는 세션에서 취한다(R3). 결과는 판별 유니온 → UI가 인라인 처리(R30).

export type SetMaxTeamsResult =
  | { ok: true; value: number }
  | { ok: false; code: string; message: string };

const SetMaxTeamsSchema = z.object({
  value: z.number().int().min(MAX_TEAMS_MIN).max(MAX_TEAMS_MAX),
});

export async function setMaxTeamsAction(input: { value: number }): Promise<SetMaxTeamsResult> {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch {
    return { ok: false, code: "NOT_FOUND", message: "페이지를 찾을 수 없어요." };
  }

  const parsed = SetMaxTeamsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_RANGE",
      message: `${MAX_TEAMS_MIN}–${MAX_TEAMS_MAX} 사이의 정수로 입력해주세요.`,
    };
  }

  // 이미 만들어진 팀을 상한 미만으로 남기지 않는다 — 줄이려면 팀을 먼저 지워야 한다.
  const current = await prisma.team.count();
  if (parsed.data.value < current) {
    return {
      ok: false,
      code: "BELOW_CURRENT",
      message: `이미 만들어진 팀이 ${current}개예요. 그보다 작게는 못 줄여요.`,
    };
  }

  await setMaxTeams(parsed.data.value, session.memberId);
  revalidatePath("/admin");
  revalidatePath("/teams"); // 팀 허브의 canCreate 가시화도 갱신한다.
  return { ok: true, value: parsed.data.value };
}
