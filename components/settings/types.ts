import type { Role } from "@/types";

// 설정 화면 뷰 DTO — Member 모델을 화면용으로 좁힌 것.
// 읽기는 RSC가 props로 내려보낸다(ADR-015). team/presentations와 동일 패턴.

/** 프로필 카드 — 이름·핸들·상태는 편집, 이메일·역할은 읽기 전용. */
export interface ProfileView {
  id: string;
  name: string;
  handle: string;
  email: string;
  role: Role;
  status: string | null;
  /** 멤버 색 토큰값 (예: "var(--m-ha)") — 아바타용 */
  color: string;
  initial: string;
}
