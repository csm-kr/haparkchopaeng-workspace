// @vitest-environment node
// 서버 전용 모듈 — LiveKit SDK(jose)는 Node Uint8Array를 요구하므로 node 환경에서 실행한다.
import { afterEach, describe, expect, it } from "vitest";
import {
  isLiveConfigured,
  issueAccessToken,
  livekitUrl,
  roomName,
} from "@/lib/livekit";

// lib/livekit.ts 단위 테스트 — 설정 분기·룸 이름·토큰 grant 규칙(R7).
// 키는 더미로 주입(서명만 확인, 외부 호출 없음). JWT는 수동 base64url 디코드(새 의존성 없음).

const KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

function setKeys() {
  process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "devkey";
  process.env.LIVEKIT_API_SECRET = "devsecret";
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// JWT payload(가운데 조각)를 외부 의존성 없이 디코드한다.
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  expect(parts).toHaveLength(3);
  const json = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

describe("isLiveConfigured", () => {
  it("키 3종이 모두 있으면 true", () => {
    setKeys();
    expect(isLiveConfigured()).toBe(true);
  });

  it("하나라도 없으면 false", () => {
    setKeys();
    for (const k of KEYS) {
      const prev = process.env[k];
      delete process.env[k];
      expect(isLiveConfigured()).toBe(false);
      process.env[k] = prev;
    }
  });

  it("placeholder(xxxx)면 false", () => {
    setKeys();
    process.env.LIVEKIT_API_KEY = "xxxx";
    expect(isLiveConfigured()).toBe(false);
  });
});

describe("roomName", () => {
  it("세션 id에서 결정적으로 파생한다(live-{id})", () => {
    expect(roomName("s1")).toBe("live-s1");
  });
});

describe("livekitUrl", () => {
  it("LIVEKIT_URL을 호출 시점에 읽어 반환한다", () => {
    setKeys();
    expect(livekitUrl()).toBe("wss://test.livekit.cloud");
  });
});

describe("issueAccessToken", () => {
  it("발표자 토큰: identity·room·join·publish + canPublishSources에 screen_share 포함", async () => {
    setKeys();
    const jwt = await issueAccessToken({
      sessionId: "s1",
      identity: "jo",
      name: "조성민",
      canPublishScreen: true,
    });
    const payload = decodeJwtPayload(jwt);
    expect(payload.sub).toBe("jo");
    const video = payload.video as Record<string, unknown>;
    expect(video.room).toBe("live-s1");
    expect(video.roomJoin).toBe(true);
    expect(video.canPublish).toBe(true);
    expect(video.canPublishData).toBe(true);
    expect(video.canPublishSources).toContain("screen_share");
  });

  it("시청자 토큰: canPublishSources에 screen_share 미포함(R7)", async () => {
    setKeys();
    const jwt = await issueAccessToken({
      sessionId: "s1",
      identity: "paeng",
      canPublishScreen: false,
    });
    const payload = decodeJwtPayload(jwt);
    expect(payload.sub).toBe("paeng");
    const video = payload.video as Record<string, unknown>;
    expect(video.room).toBe("live-s1");
    expect(video.canPublishSources).toContain("camera");
    expect(video.canPublishSources).not.toContain("screen_share");
    expect(video.canPublishSources).not.toContain("screen_share_audio");
  });

  it("토큰은 [object Promise]가 아니라 await된 JWT 문자열이다", async () => {
    setKeys();
    const jwt = await issueAccessToken({
      sessionId: "s1",
      identity: "jo",
      canPublishScreen: true,
    });
    expect(typeof jwt).toBe("string");
    expect(jwt).not.toContain("[object Promise]");
    expect(jwt.split(".")).toHaveLength(3);
  });
});
