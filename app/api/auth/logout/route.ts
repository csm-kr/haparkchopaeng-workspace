import { destroySession } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/http";

// POST /api/auth/logout — 세션 종료(쿠키 제거).
export async function POST(): Promise<Response> {
  try {
    await destroySession();
    return ok({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
