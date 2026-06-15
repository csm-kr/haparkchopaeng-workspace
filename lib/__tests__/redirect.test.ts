import { describe, expect, it } from "vitest";

// 진입 흐름 순수 헬퍼(ADR-018/SECURITY) 검증.
// - sanitizeNext: 오픈 리다이렉트 차단(same-origin 절대경로만)
// - needsTeamOnboarding: 팀 없음 진입 가드 결정(무한 루프 예외 포함)

import { needsTeamOnboarding, sanitizeNext } from "@/lib/redirect";

describe("sanitizeNext (오픈 리다이렉트 차단)", () => {
  it("같은 오리진 절대경로는 그대로 통과한다", () => {
    expect(sanitizeNext("/invite/abc123")).toBe("/invite/abc123");
    expect(sanitizeNext("/dashboard")).toBe("/dashboard");
    expect(sanitizeNext("/papers/x?lens=research")).toBe("/papers/x?lens=research");
  });

  it("null/undefined/빈 문자열·비문자열은 null", () => {
    expect(sanitizeNext(null)).toBeNull();
    expect(sanitizeNext(undefined)).toBeNull();
    expect(sanitizeNext("")).toBeNull();
  });

  it("절대 URL(스킴 포함)은 거부한다", () => {
    expect(sanitizeNext("https://evil.com")).toBeNull();
    expect(sanitizeNext("http://evil.com/x")).toBeNull();
    expect(sanitizeNext("javascript:alert(1)")).toBeNull();
  });

  it("프로토콜 상대 URL(// 또는 /\\)은 거부한다", () => {
    expect(sanitizeNext("//evil.com")).toBeNull();
    expect(sanitizeNext("/\\evil.com")).toBeNull();
  });

  it("'/'로 시작하지 않으면 거부한다", () => {
    expect(sanitizeNext("dashboard")).toBeNull();
    expect(sanitizeNext("../etc")).toBeNull();
  });

  it("공백·제어문자(헤더 인젝션)는 거부한다", () => {
    expect(sanitizeNext("/foo\nSet-Cookie: x")).toBeNull();
    expect(sanitizeNext("/foo bar")).toBeNull();
    expect(sanitizeNext("/foo\tbar")).toBeNull();
  });
});

describe("needsTeamOnboarding (팀 없음 진입 가드)", () => {
  it("멤버십이 있으면 가드하지 않는다", () => {
    expect(needsTeamOnboarding("/dashboard", true)).toBe(false);
    expect(needsTeamOnboarding("/teams/new", true)).toBe(false);
  });

  it("멤버십이 없으면 일반 경로에서 팀 만들기로 보낸다", () => {
    expect(needsTeamOnboarding("/dashboard", false)).toBe(true);
    expect(needsTeamOnboarding("/library", false)).toBe(true);
  });

  it("팀 만들기 화면 자신은 예외(무한 루프 방지)", () => {
    expect(needsTeamOnboarding("/teams/new", false)).toBe(false);
  });

  it("초대 경로는 예외(초대받은 팀 없는 사용자가 합류할 수 있어야 함)", () => {
    expect(needsTeamOnboarding("/invite/tok", false)).toBe(false);
  });
});
