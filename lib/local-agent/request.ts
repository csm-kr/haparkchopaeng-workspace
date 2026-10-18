import { z } from "zod";
import { getConnectionSession } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { HttpError, ok, toErrorResponse } from "@/lib/http";
import type { DesktopIdentity, LocalAgentScope } from "./service";
import { validateDeviceToken } from "./security";

/** SameSite is useful, but local-execution authority also requires an exact Origin. */
export function assertWebOrigin(req: Request): void {
  if (req.headers.get("origin") !== new URL(req.url).origin) {
    throw new HttpError(403, "ORIGIN_FORBIDDEN", "이 웹사이트에서 다시 연결해주세요.");
  }
}

export async function webScope(req: Request, mutation = false): Promise<LocalAgentScope> {
  if (mutation) assertWebOrigin(req);
  const session = await getConnectionSession();
  if (!session) throw new HttpError(401, "UNAUTHORIZED", "로그인한 뒤 AI를 다시 연결해주세요.");
  const team = await getActiveTeam(session.memberId);
  if (!team) throw new HttpError(403, "FORBIDDEN", "먼저 사용할 팀을 선택해주세요.");
  return { memberId: session.memberId, teamId: team.id, sessionKey: session.sessionKey, sessionExpiresAt: session.expiresAt };
}

export function desktopIdentity(req: Request): DesktopIdentity {
  const deviceId = req.headers.get("x-local-agent-device");
  const auth = req.headers.get("authorization") ?? "";
  const deviceToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!deviceId || deviceId.length > 150 || !validateDeviceToken(deviceToken)) {
    throw new HttpError(401, "DEVICE_UNAUTHORIZED", "AI 브릿지 승인이 필요해요.");
  }
  return { deviceId, deviceToken };
}

export async function parseJson<T>(req: Request, schema: z.ZodType<T>, maxBytes = 262_144): Promise<T> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new HttpError(415, "JSON_REQUIRED", "요청 형식을 확인해주세요.");
  if (Number(req.headers.get("content-length")) > maxBytes) throw new HttpError(413, "REQUEST_TOO_LARGE", "요청이 너무 커요. 내용을 줄여주세요.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "BAD_REQUEST", "요청 내용을 확인해주세요.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "REQUEST_TOO_LARGE", "요청이 너무 커요. 내용을 줄여주세요.");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "BAD_REQUEST", "요청 내용을 확인해주세요."); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "BAD_REQUEST", "요청 내용을 확인해주세요.");
  return parsed.data;
}

/** Authenticated status, pairing codes and answers must never enter shared caches. */
export async function response<T>(action: () => Promise<T>, status = 200): Promise<Response> {
  let result: Response;
  try { result = ok(await action(), status); } catch (error) { result = toErrorResponse(error); }
  result.headers.set("Cache-Control", "no-store, private");
  result.headers.set("Vary", "Cookie, Authorization");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}
