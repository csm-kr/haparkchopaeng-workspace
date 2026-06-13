import { prisma } from "@/lib/prisma";
import type { Role } from "@/types";
import type { PendingInviteView, TeamMemberView } from "@/components/team";

// 팀 서버 조회 — 읽기는 RSC에서 Prisma 직접(ADR-015/R32).
// 멤버 목록(역할 포함) + 대기 중인 초대. 클라이언트는 이 데이터를 fetch하지 않는다.

/** DB의 role(String)을 Role 유니온으로 좁힌다(허용값은 시드/검증으로 보장). */
function toRole(value: string): Role {
  return value === "관리자" || value === "게스트" ? value : "멤버";
}

export interface TeamView {
  members: TeamMemberView[];
  invites: PendingInviteView[];
}

export async function getTeam(): Promise<TeamView> {
  const [members, invites] = await Promise.all([
    prisma.member.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({
      where: { status: "pending" }, // 대기 중인 초대만(점선 행, SCREENS)
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      handle: m.handle,
      email: m.email,
      role: toRole(m.role),
      color: m.color,
      initial: m.initial,
    })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: toRole(i.role),
      createdAt: i.createdAt.toISOString(),
    })),
  };
}
