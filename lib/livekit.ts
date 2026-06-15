import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";

// LiveKit 토큰·룸 클라이언트 — 서버 전용(ADR-019, ADR-002 대체).
// 앱은 입장 토큰 발급·권한 체크·룸 정리만 담당. 영상·음성·화면공유 트랙은 LiveKit(SFU)에 위임.
// CRITICAL: 키는 .env(서버)에서만(R2). 환경변수는 모듈 로드가 아니라 호출 시점에 읽는다
//   — 키 없이도 next build/test가 통과해야 한다. 실제 토큰 발급은 런타임에 진짜 키로만 동작.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * 라이브가 실제로 켜질 수 있는 설정인지 — 키 3종이 있고 placeholder가 아닌지.
 * 라우트가 호출 전에 확인해 "아직 설정 안 됨"을 친절히 안내한다(정체불명 500 대신 503, R30).
 */
export function isLiveConfigured(): boolean {
  const placeholder = (v: string | undefined) =>
    !v || v.trim() === "" || /^x+$/i.test(v.trim());
  return (
    !placeholder(process.env.LIVEKIT_URL) &&
    !placeholder(process.env.LIVEKIT_API_KEY) &&
    !placeholder(process.env.LIVEKIT_API_SECRET)
  );
}

/** wss:// 접속 URL — 클라가 LiveKit 룸에 연결할 주소. 호출 시점에 읽는다(R2). */
export function livekitUrl(): string {
  return requireEnv("LIVEKIT_URL");
}

/** 세션 id → 결정적 룸 이름. 룸 이름은 LiveSession.id에서 파생(ADR-019). */
export function roomName(sessionId: string): string {
  return `live-${sessionId}`;
}

export interface IssueTokenOptions {
  sessionId: string;
  /** identity = Member.id. 반드시 세션에서 주입된 값(R3). */
  identity: string;
  name?: string;
  /** 발표자만 true — 화면공유 grant(R7). */
  canPublishScreen: boolean;
}

/** 참가자별 LiveKit AccessToken(JWT) 발급. 발표자만 화면공유 grant를 받는다(R7). */
export async function issueAccessToken(opts: IssueTokenOptions): Promise<string> {
  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");

  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    name: opts.name,
  });
  // 화면공유는 발표자만(R7). 시청자 토큰엔 screen_share를 넣지 않는다.
  const canPublishSources = opts.canPublishScreen
    ? [
        TrackSource.CAMERA,
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ]
    : [TrackSource.CAMERA, TrackSource.MICROPHONE];
  at.addGrant({
    roomJoin: true,
    room: roomName(opts.sessionId),
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources,
  });

  // CRITICAL: toJwt()는 Promise를 반환할 수 있다 — 반드시 await(미await 시 [object Promise] 토큰).
  return await at.toJwt();
}

/** 세션 종료 시 LiveKit 룸 삭제(best-effort, 실패 무시 — 세션은 이미 DB에서 비활성). */
export async function deleteRoom(sessionId: string): Promise<void> {
  try {
    const apiKey = requireEnv("LIVEKIT_API_KEY");
    const apiSecret = requireEnv("LIVEKIT_API_SECRET");
    // RoomServiceClient는 http(s) 호스트를 받는다 — wss://→https:// (ws://→http://).
    const host = livekitUrl().replace(/^ws/, "http");
    const svc = new RoomServiceClient(host, apiKey, apiSecret);
    await svc.deleteRoom(roomName(sessionId));
  } catch (e) {
    console.warn("[livekit] deleteRoom 실패(무시):", e);
  }
}
