import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/lib/http";

// Browsers wake hidden tabs about once a minute, so the web grant must outlive one missed renewal.
export const LEASE_MS = 120_000;
// Installed apps reject a lease more than 60 seconds ahead; they refresh it every desktop heartbeat.
export const DESKTOP_LEASE_MS = 45_000;
export const WEB_HEARTBEAT_SECONDS = 15;
export const DESKTOP_HEARTBEAT_SECONDS = 5;
export const ATTEMPT_MS = 5 * 60_000;
export const MAX_PAIR_FAILURES = 5;
export const MAX_JOB_MS = 10 * 60_000;
export const SNAPSHOT_FRESH_MS = 90_000;

export function serverSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new HttpError(503, "NOT_CONFIGURED", "AI 연결 설정을 준비하고 있어요. 잠시 후 다시 시도해주세요.");
  return secret;
}

/** Deterministic only for authenticated reloads; keyed, attempt-specific and never in URIs/logs. */
export function pairingCode(attemptId: string, secret = serverSecret()): string {
  const bytes = createHmac("sha256", secret).update(`local-agent:pair-code:v1:${attemptId}`).digest();
  return String(bytes.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export function hashCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sameCredential(value: string, storedHash: string): boolean {
  const actual = Buffer.from(hashCredential(value));
  const expected = Buffer.from(storedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateDeviceToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, "base64url").length === 32;
}

export function assertGrantUsable(grant: { revokedAt: Date | null; leaseExpiresAt: Date }, now = new Date()): void {
  if (grant.revokedAt || grant.leaseExpiresAt.getTime() <= now.getTime()) {
    throw new HttpError(403, "WEB_PERMISSION_EXPIRED", "웹 연결 권한이 끝났어요. 웹에서 AI 연결을 다시 눌러주세요.");
  }
}
