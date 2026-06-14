import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveInput,
  isLiveConfigured,
  verifyWebhookSignature,
} from "@/lib/cloudflare";

// Cloudflare Stream Live 클라이언트 단위 테스트 — fetch를 모킹한다(AC).
// ① createLiveInput: 응답 매핑·Bearer 인증·녹화 자동·키 부재 시 호출 시점 throw(모듈 로드 아님, R2)
// ② verifyWebhookSignature: 유효 서명 통과·위조 거부(S4.6)

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_STREAM_API_TOKEN;
  delete process.env.CLOUDFLARE_WEBHOOK_SECRET;
});

describe("createLiveInput", () => {
  it("Cloudflare 응답을 매핑하고 Bearer 인증 + 녹화 자동으로 호출한다", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "tok";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          uid: "li1",
          rtmps: { url: "rtmps://live", streamKey: "KEY" },
          srt: { url: "srt://live", streamId: "sid", passphrase: "PASS" },
          playback: { hls: "https://hls/manifest.m3u8" },
          webRTC: { url: "https://cf/webRTC/publish" },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await createLiveInput();
    expect(out).toEqual({
      liveInputId: "li1",
      rtmps: { url: "rtmps://live", streamKey: "KEY" },
      srt: { url: "srt://live", streamId: "sid", passphrase: "PASS" },
      playback: { hls: "https://hls/manifest.m3u8" },
      webRTC: { url: "https://cf/webRTC/publish" },
    });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/accounts/acc/stream/live_inputs");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(opts.body).recording.mode).toBe("automatic");
  });

  it("키가 없으면 호출 시점에 throw하고 fetch하지 않는다(모듈 로드 아님, R2)", async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_STREAM_API_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createLiveInput()).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Cloudflare 비-2xx는 에러로 던진다", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc";
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(createLiveInput()).rejects.toThrow(/실패/);
  });
});

describe("isLiveConfigured", () => {
  it("키가 없거나 placeholder(xxxx)면 false", () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_STREAM_API_TOKEN;
    expect(isLiveConfigured()).toBe(false);

    process.env.CLOUDFLARE_ACCOUNT_ID = "xxxxxxxx";
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "xxxxxxxx";
    expect(isLiveConfigured()).toBe(false);
  });

  it("실제 키가 둘 다 있으면 true", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "real-account";
    process.env.CLOUDFLARE_STREAM_API_TOKEN = "real-token";
    expect(isLiveConfigured()).toBe(true);
  });
});

describe("verifyWebhookSignature", () => {
  it("유효 서명은 통과, 위조/누락은 거부한다", () => {
    process.env.CLOUDFLARE_WEBHOOK_SECRET = "whsec";
    const body = JSON.stringify({ liveInput: "li1", playback: { hls: "h" } });
    const valid = crypto
      .createHmac("sha256", "whsec")
      .update(body)
      .digest("hex");
    const forged = crypto
      .createHmac("sha256", "wrong-secret")
      .update(body)
      .digest("hex");

    expect(verifyWebhookSignature(body, valid)).toBe(true);
    expect(verifyWebhookSignature(body, forged)).toBe(false);
    expect(verifyWebhookSignature(body, "deadbeef")).toBe(false);
    expect(verifyWebhookSignature(body, null)).toBe(false);
  });

  it("시크릿이 없으면 거부한다(false)", () => {
    delete process.env.CLOUDFLARE_WEBHOOK_SECRET;
    expect(verifyWebhookSignature("{}", "anything")).toBe(false);
  });
});
