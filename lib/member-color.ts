// 멤버 아바타 색 — 팔레트에서 seed로 결정적 선택(ADR-018 멤버 표시).
// CRITICAL: 토큰 문자열은 app/globals.css의 --m-* 정의와 1:1로 맞춘다(코랄/그린/퍼플/앰버).

export const MEMBER_COLORS = [
  "var(--m-ha)",
  "var(--m-bak)",
  "var(--m-jo)",
  "var(--m-paeng)",
] as const;

/** seed(이메일 등 안정 식별자)를 팔레트 색 하나로 결정적 매핑. 같은 seed → 같은 색. */
export function pickMemberColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return MEMBER_COLORS[hash % MEMBER_COLORS.length];
}
