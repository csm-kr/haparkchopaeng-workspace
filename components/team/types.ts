import type { InviteRole, TeamRole } from "@/types";

// 팀 화면 뷰 DTO — DB 모델(Membership/Member/Invite)을 화면용으로 좁힌 것.
// 읽기는 RSC가 props로 내려보낸다(ADR-015). presentations/schedule와 동일 패턴.
// 멀티팀(ADR-018): 역할은 팀별 멤버십 역할(owner/admin/member) — UI 표기도 영어 그대로.

/** 멤버 행 — 아바타·이름·이메일·역할 배지(SCREENS §team). 역할은 팀 멤버십 역할. */
export interface TeamMemberView {
  id: string;
  name: string;
  handle: string;
  email: string;
  role: TeamRole;
  /** 멤버 색 토큰값 (예: "var(--m-ha)") */
  color: string;
  initial: string;
}

/** 활성 초대(점선 행). 토큰 초대(ADR-018) — 이메일 없음, 역할은 admin|member, 사용 횟수 표기. */
export interface PendingInviteView {
  id: string;
  role: InviteRole;
  /** 초대 링크 토큰(목록 응답에는 없을 수 있음 — 발급/재전송 시에만) */
  token?: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
}
