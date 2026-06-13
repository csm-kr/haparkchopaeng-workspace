import type { ApiErr, ApiOk } from "@/types";

// route handler 공용 응답 헬퍼 + 에러 타입. 응답 포맷은 API.md(`{ data }` / `{ error }`)와 1:1.
// 시스템 코드는 일관되게 두고, 사용자에게 보이는 message는 따뜻한 한국어로 둔다(R30).

/** 핸들러 진입부에서 던지는 인증/인가/검증 에러. status·code·message를 ApiErr로 변환한다. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ data } satisfies ApiOk<T>, { status });
}

export function fail(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } } satisfies ApiErr, { status });
}

/** 핸들러에서 던진 HttpError를 ApiErr 응답으로. 그 외(예상 못한 오류)는 500으로 감싼다. */
export function toErrorResponse(e: unknown): Response {
  if (e instanceof HttpError) return fail(e.status, e.code, e.message);
  console.error(e);
  return fail(500, "INTERNAL", "잠시 후 다시 시도해주세요.");
}
