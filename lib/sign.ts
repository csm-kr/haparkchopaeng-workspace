import crypto from "node:crypto";

// HMAC-SHA256 서명 토큰의 공용 코어 (서버 전용). 세션(lib/auth)·초대(lib/invite)가 공유한다.
// 형식: base64url(payloadJSON).base64url(hmac). 비밀은 호출부가 주입한다(R2: 키는 서버에서만).

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export interface SignOptions {
  /** 만료까지 초. 생략하면 무기한(`exp` 미포함). */
  expiresInSec?: number;
}

/** payload를 JSON으로 직렬화하고 HMAC 서명을 붙인다. expiresInSec가 있으면 `exp`(epoch초)를 추가. */
export function signPayload<T extends Record<string, unknown>>(
  payload: T,
  secret: string,
  opts: SignOptions = {},
): string {
  const body: Record<string, unknown> = { ...payload };
  if (opts.expiresInSec != null) {
    body.exp = Math.floor(Date.now() / 1000) + opts.expiresInSec;
  }
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** 서명·만료를 검증하고 payload를 돌려준다. 위조·변조·만료·형식 오류는 모두 null. */
export function verifyPayload<T>(token: string, secret: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;

  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  // 타이밍 세이프 비교(길이 먼저 확인 — timingSafeEqual은 길이가 같아야 함).
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof body.exp === "number" && body.exp < Math.floor(Date.now() / 1000)) {
    return null; // 만료
  }
  return body as T;
}
