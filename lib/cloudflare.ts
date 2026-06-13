import crypto from "node:crypto";

// Cloudflare Stream Live 클라이언트 — 서버 전용(ADR-002).
// 앱은 Live Input 생성·삭제·녹화 웹훅 검증만 담당한다. 인코딩/HLS/CDN/녹화는 Cloudflare에 위임.
// CRITICAL: 키는 .env(서버)에서만(R2). 환경변수는 모듈 로드가 아니라 호출 시점에 읽는다
//   — 키 없이도 next build/test가 통과해야 한다(R2). 실제 송출은 런타임에 진짜 키로만 동작.

const API_BASE = "https://api.cloudflare.com/client/v4";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export interface LiveInput {
  liveInputId: string;
  /** 송출 자격증명 — 발표자 본인에게만 노출(SECURITY/R36). */
  rtmps: { url: string; streamKey: string };
  /** 송출 자격증명(SRT) — 발표자 본인에게만 노출(SECURITY/R36). */
  srt: { url: string; streamId: string; passphrase: string };
  /** 시청자용 재생 정보(HLS). */
  playback: { hls: string };
}

/** Live Input을 만든다(녹화 자동). 발표자 송출 자격증명 + 재생 정보를 돌려준다(S3). */
export async function createLiveInput(): Promise<LiveInput> {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requireEnv("CLOUDFLARE_STREAM_API_TOKEN");

  const res = await fetch(`${API_BASE}/accounts/${accountId}/stream/live_inputs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recording: { mode: "automatic" } }),
  });
  if (!res.ok) {
    throw new Error(`Cloudflare Live Input 생성 실패 (${res.status})`);
  }

  const json = (await res.json()) as { result: CloudflareLiveInput };
  return mapLiveInput(json.result);
}

/**
 * Live Input의 재생 정보(HLS)만 조회한다(시청자 join용).
 * CRITICAL: 송출 자격증명(streamKey/passphrase)은 호출자에게 돌려주지 않는다(R36) — hls만 반환.
 */
export async function getLiveInputPlayback(
  liveInputId: string,
): Promise<{ hls: string }> {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requireEnv("CLOUDFLARE_STREAM_API_TOKEN");

  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/stream/live_inputs/${liveInputId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Cloudflare Live Input 조회 실패 (${res.status})`);
  }

  const json = (await res.json()) as { result: CloudflareLiveInput };
  return { hls: json.result.playback?.hls ?? "" };
}

/** Live Input을 삭제한다(세션 종료 정리, S4). */
export async function deleteLiveInput(liveInputId: string): Promise<void> {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requireEnv("CLOUDFLARE_STREAM_API_TOKEN");

  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/stream/live_inputs/${liveInputId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Cloudflare Live Input 삭제 실패 (${res.status})`);
  }
}

/**
 * 웹훅 서명 검증(HMAC-SHA256, 타이밍 안전 비교). 세션 인증이 아니라 서명으로 보호(S4.6).
 * 시크릿이 없거나 헤더가 없으면 거부(false). 키는 호출 시점에 읽는다(R2).
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;
  const secret = process.env.CLOUDFLARE_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const given = Buffer.from(signatureHeader);
  const want = Buffer.from(expected);
  // timingSafeEqual은 길이가 같아야 하므로 길이를 먼저 확인한다.
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}

interface CloudflareLiveInput {
  uid: string;
  rtmps: { url: string; streamKey: string };
  srt: { url: string; streamId: string; passphrase: string };
  playback?: { hls?: string };
}

function mapLiveInput(r: CloudflareLiveInput): LiveInput {
  return {
    liveInputId: r.uid,
    rtmps: { url: r.rtmps.url, streamKey: r.rtmps.streamKey },
    srt: {
      url: r.srt.url,
      streamId: r.srt.streamId,
      passphrase: r.srt.passphrase,
    },
    playback: { hls: r.playback?.hls ?? "" },
  };
}
