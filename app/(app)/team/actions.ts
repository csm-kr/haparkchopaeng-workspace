"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { RemoveActionResult, RoleActionResult } from "@/components/team";
import type { Role } from "@/types";

// 팀 쓰기 — 역할 변경/내보내기. step4에 엔드포인트가 없는 동작만 Server Action으로 보강한다.
// (초대 생성/취소/재전송은 step4의 route handler를 그대로 호출한다 — team-manager의 fetch.)
// CRITICAL: 관리 액션은 관리자 전용으로 서버 진입부에서 강제(👑, R19/SECURITY). UI 숨김은 보조.
// CRITICAL: 공개 가입 경로를 만들지 않는다 — 합류는 초대 토큰으로만(R18/ADR-007).

function toRole(value: string): Role {
  return value === "관리자" || value === "게스트" ? value : "멤버";
}

const ChangeRoleSchema = z.object({
  memberId: z.string().min(1),
  role: z.enum(["관리자", "멤버", "게스트"]),
});

/**
 * 멤버 역할 변경 — 관리자만(👑). 본인 역할은 바꿀 수 없다(자기 권한 박탈 방지, SECURITY 본인 보호).
 */
export async function changeMemberRole(input: {
  memberId: string;
  role: Role;
}): Promise<RoleActionResult> {
  let session;
  try {
    session = await requireRole("관리자");
  } catch {
    return { ok: false, message: "이 작업은 관리자만 할 수 있어요." };
  }

  const parsed = ChangeRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "역할을 확인해주세요." };
  const { memberId, role } = parsed.data;

  // 본인 보호 — 자기 자신의 역할은 바꿀 수 없다(실수로 관리 권한 상실 방지).
  if (memberId === session.memberId) {
    return { ok: false, message: "자신의 역할은 바꿀 수 없어요." };
  }

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return { ok: false, message: "멤버를 찾을 수 없어요." };

  const updated = await prisma.member.update({
    where: { id: memberId },
    data: { role },
  });
  revalidatePath("/team");

  return {
    ok: true,
    member: {
      id: updated.id,
      name: updated.name,
      handle: updated.handle,
      email: updated.email,
      role: toRole(updated.role),
      color: updated.color,
      initial: updated.initial,
    },
  };
}

const RemoveSchema = z.object({ memberId: z.string().min(1) });

/**
 * 멤버 내보내기 — 관리자만(👑). 본인은 내보낼 수 없다(자기 잠금 방지, SECURITY 본인 보호).
 * 파괴적 액션이므로 UI는 확인 다이얼로그를 거친다(R27).
 */
export async function removeMember(input: {
  memberId: string;
}): Promise<RemoveActionResult> {
  let session;
  try {
    session = await requireRole("관리자");
  } catch {
    return { ok: false, message: "이 작업은 관리자만 할 수 있어요." };
  }

  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "잘못된 요청이에요." };
  const { memberId } = parsed.data;

  if (memberId === session.memberId) {
    return { ok: false, message: "자신을 내보낼 수는 없어요." };
  }

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return { ok: false, message: "멤버를 찾을 수 없어요." };

  await prisma.member.delete({ where: { id: memberId } });
  revalidatePath("/team");

  return { ok: true, memberId };
}
