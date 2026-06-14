import { z } from "zod";
import { createSession } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// POST /api/auth/login — (개발용) 시드된 멤버를 이메일로 식별 → 세션 발급.
// CRITICAL: 공개 가입 경로가 아니다. 미등록 이메일은 401 — 합류는 초대 토큰으로만(ADR-007/R18).
// TODO(prod): 매직링크/OAuth 등 실제 인증 수단은 미결(ISSUES 후속). 비밀번호 컬럼 추가 금지.

const LoginInput = z.object({ email: z.email() });

export async function POST(req: Request): Promise<Response> {
  try {
    // CRITICAL: 비밀번호 없는 이메일 식별 로그인은 로컬 개발 편의용이다(quick-login).
    // 프로덕션(공개 URL)에서는 절대 허용하지 않는다 — 인증은 Google OAuth로만(ADR-017).
    // 막지 않으면 시드 이메일을 아는 누구나 관리자로 로그인할 수 있다.
    if (process.env.NODE_ENV === "production") {
      return fail(404, "NOT_FOUND", "찾을 수 없어요.");
    }

    const body: unknown = await req.json().catch(() => null);
    const parsed = LoginInput.safeParse(body);
    if (!parsed.success) return fail(400, "BAD_REQUEST", "이메일을 확인해주세요.");

    const member = await prisma.member.findUnique({ where: { email: parsed.data.email } });
    if (!member) return fail(401, "UNAUTHORIZED", "등록된 멤버가 아니에요.");

    await createSession(member.id);
    return ok(member);
  } catch (e) {
    return toErrorResponse(e);
  }
}
