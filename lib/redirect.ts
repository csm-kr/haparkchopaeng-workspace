// 진입 흐름 순수 헬퍼 (서버/엣지 안전 — 외부 의존 없음).
// 리다이렉트 정제·팀 없음 진입 가드 결정을 한곳에 모아 route handler/layout이 공유한다.

/**
 * 로그인 후 복귀 목적지(next)를 정제한다 — **same-origin 절대경로만** 허용(SECURITY: 오픈 리다이렉트 차단).
 * 통과 조건: "/"로 시작 · "//"·"/\"(프로토콜 상대) 아님 · 공백/제어문자(헤더 인젝션) 없음.
 * 그 외(절대 URL·스킴·상대경로 등)는 모두 null.
 */
export function sanitizeNext(next: string | null | undefined): string | null {
  if (typeof next !== "string" || next === "") return null;
  if (!next.startsWith("/")) return null;
  // "//evil.com"·"/\evil.com" 은 브라우저가 외부 오리진으로 해석할 수 있다.
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  // 공백·제어문자는 헤더 인젝션 벡터 — 거부(하이픈 등 일반 경로 문자는 허용).
  if (/[\s\x00-\x1f\x7f]/.test(next)) return null;
  return next;
}

/** 가드 예외 경로(팀 없는 사용자도 도달해야 하는 곳) — 보내면 합류 자체를 막는다. */
const ONBOARDING_EXEMPT = ["/invite"];

/**
 * "팀 없음" 진입 가드 결정(순수). 멤버십이 없고 예외 경로가 아니면 팀 허브(/teams)로 보낸다(ADR-021/018).
 * 예외: /invite(초대 합류). 팀 허브(/teams)는 (app) 레이아웃 밖이라 이 가드를 타지 않으므로 예외 목록에 둘 필요가 없다.
 * 인증 경로도 (app) 레이아웃 밖이라 여기 오지 않는다.
 */
export function needsTeamOnboarding(pathname: string, hasMembership: boolean): boolean {
  if (hasMembership) return false;
  if (ONBOARDING_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return false;
  }
  return true;
}
