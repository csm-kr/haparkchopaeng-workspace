import type { InviteRole, Role } from "@/types";

// 팀 화면 뷰 DTO — DB 모델(Member/Invite)을 화면용으로 좁힌 것.
// 읽기는 RSC가 props로 내려보낸다(ADR-015). presentations/schedule와 동일 패턴.

/** 멤버 행 — 아바타·이름·이메일·역할 배지(SCREENS §team). */
export interface TeamMemberView {
  id: string;
  name: string;
  handle: string;
  email: string;
  role: Role;
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

/**
 * 역할 변경 결과 — 권한(403)·본인 보호 등을 client가 다룰 수 있게 판별 유니온으로.
 * 관리 액션은 서버에서 관리자 전용으로 강제된다(👑, R19) — 결과만 돌려받는다.
 */
export type RoleActionResult =
  | { ok: true; member: TeamMemberView }
  | { ok: false; message: string };

/** 내보내기 결과 — 성공 시 제거된 memberId. 실패면 사유(권한·본인 보호). */
export type RemoveActionResult =
  | { ok: true; memberId: string }
  | { ok: false; message: string };
