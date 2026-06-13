import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { signPayload, verifyPayload } from "@/lib/sign";
import type { Role } from "@/types";

// 세션 플럼빙 (서버 전용). HTTP-only·Secure·SameSite 서명 쿠키.
// CRITICAL: 세션은 서버에서만 읽는다. 클라이언트가 보낸 식별자/역할을 신뢰하지 않는다(R3, SECURITY §신뢰 경계).

const SESSION_COOKIE = "hapark_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7일

export interface Session {
  memberId: string;
  role: Role;
}

interface SessionPayload {
  memberId: string;
  role: Role;
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  // 비밀은 .env(서버)에서만. 빌드 타임이 아니라 호출 시점에 읽는다(R2).
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

/**
 * 멤버를 식별해 서명 세션 쿠키를 설정한다.
 * role은 DB에서 취한다 — 클라이언트 입력이 아니다(R3).
 * TODO(prod): role 변경은 재로그인 시 반영. 즉시 반영이 필요하면 getSession에서 DB 재조회로 전환.
 */
export async function createSession(memberId: string): Promise<void> {
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) throw new HttpError(401, "UNAUTHORIZED", "로그인할 수 없어요.");

  const token = signPayload(
    // role 허용값은 시드/검증으로 보장됨(DB는 String) — DTO Role로 좁힌다.
    { memberId, role: member.role as Role } satisfies SessionPayload,
    authSecret(),
    { expiresInSec: SESSION_TTL_SEC },
  );

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

/** 세션 쿠키를 제거한다(로그아웃). */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** 쿠키를 검증해 세션을 돌려준다. 없거나 위조/만료면 null. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = verifyPayload<SessionPayload>(token, authSecret());
  if (!payload) return null;
  return { memberId: payload.memberId, role: payload.role };
}

/** 인증 필수. 미인증이면 401(HttpError). */
export async function requireAuth(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "UNAUTHORIZED", "로그인이 필요해요.");
  return session;
}

/** 역할 가드. 허용 역할이 아니면 403(HttpError). 권한 체크는 핸들러 진입부에서(R19). */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await requireAuth();
  if (!roles.includes(session.role)) {
    throw new HttpError(403, "FORBIDDEN", "이 작업은 권한이 부족해요.");
  }
  return session;
}
