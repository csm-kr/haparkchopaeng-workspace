import { beforeEach, describe, expect, it, vi } from "vitest";

// broadcastLive 단위 테스트 — Supabase admin 채널을 모킹한다(AC).
// 검증: graceful(미설정/전송 실패 시 throw 금지) + 정상 시 broadcast send 호출.

const { createSupabaseAdminMock } = vi.hoisted(() => ({
  createSupabaseAdminMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: createSupabaseAdminMock,
}));

const { broadcastLive, LIVE_CHANNEL } = await import("@/lib/realtime");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("broadcastLive", () => {
  it("정상: LIVE_CHANNEL에 broadcast로 전송한다", async () => {
    const sendMock = vi.fn().mockResolvedValue("ok");
    const removeChannelMock = vi.fn();
    const channelMock = vi.fn().mockReturnValue({ send: sendMock });
    createSupabaseAdminMock.mockReturnValue({
      channel: channelMock,
      removeChannel: removeChannelMock,
    });

    await expect(
      broadcastLive("live.started", { sessionId: "s1" }),
    ).resolves.toBeUndefined();

    expect(channelMock).toHaveBeenCalledWith(LIVE_CHANNEL);
    expect(sendMock).toHaveBeenCalledWith({
      type: "broadcast",
      event: "live.started",
      payload: { sessionId: "s1" },
    });
  });

  it("graceful: Supabase 미설정(createSupabaseAdmin throw) 시 throw하지 않는다", async () => {
    createSupabaseAdminMock.mockImplementation(() => {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
    });

    await expect(
      broadcastLive("live.ended", { sessionId: "s1" }),
    ).resolves.toBeUndefined();
  });

  it("graceful: 전송 실패 시 throw하지 않는다", async () => {
    const sendMock = vi.fn().mockRejectedValue(new Error("network"));
    createSupabaseAdminMock.mockReturnValue({
      channel: vi.fn().mockReturnValue({ send: sendMock }),
      removeChannel: vi.fn(),
    });

    await expect(broadcastLive("live.started")).resolves.toBeUndefined();
  });
});
