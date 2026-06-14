import { describe, expect, it, vi } from "vitest";
import { publishWhip } from "@/lib/whip";

// WHIP(WebRTC-HTTP Ingestion) publish 클라이언트 단위 테스트.
// RTCPeerConnection·fetch를 주입해 SDP 교환·정리(stop)를 브라우저 없이 검증한다.

function makeFakeTrack(kind: "video" | "audio") {
  return { kind, stop: vi.fn() } as unknown as MediaStreamTrack;
}

function makeFakeStream(tracks: MediaStreamTrack[]) {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

function makeFakePeer() {
  const calls = {
    addTrack: vi.fn(),
    setLocalDescription: vi.fn(),
    setRemoteDescription: vi.fn(),
    close: vi.fn(),
  };
  const pc = {
    iceGatheringState: "complete" as RTCIceGatheringState,
    localDescription: { type: "offer", sdp: "OFFER_SDP" },
    addTrack: calls.addTrack,
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "OFFER_SDP" })),
    setLocalDescription: calls.setLocalDescription,
    setRemoteDescription: calls.setRemoteDescription,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    close: calls.close,
  };
  return { pc: pc as unknown as RTCPeerConnection, calls };
}

function whipOkResponse() {
  return {
    ok: true,
    status: 201,
    text: async () => "ANSWER_SDP",
    headers: {
      get: (h: string) =>
        h.toLowerCase() === "location"
          ? "https://whip.example/resource/abc"
          : null,
    },
  } as unknown as Response;
}

const ENDPOINT = "https://cf.example/li1/webRTC/publish";

describe("publishWhip", () => {
  it("트랙을 추가하고 offer를 application/sdp로 POST한 뒤 answer를 적용한다", async () => {
    const { pc, calls } = makeFakePeer();
    const fetchImpl = vi.fn().mockResolvedValue(whipOkResponse());
    const stream = makeFakeStream([
      makeFakeTrack("video"),
      makeFakeTrack("audio"),
    ]);

    const session = await publishWhip({
      stream,
      endpoint: ENDPOINT,
      createPeer: () => pc,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(calls.addTrack).toHaveBeenCalledTimes(2);
    expect(calls.setLocalDescription).toHaveBeenCalled();

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/sdp");
    expect(opts.body).toBe("OFFER_SDP");

    expect(calls.setRemoteDescription).toHaveBeenCalledWith(
      expect.objectContaining({ type: "answer", sdp: "ANSWER_SDP" }),
    );
    expect(typeof session.stop).toBe("function");
  });

  it("stop()은 WHIP 리소스를 DELETE하고 PeerConnection을 닫는다", async () => {
    const { pc, calls } = makeFakePeer();
    const fetchImpl = vi.fn().mockResolvedValue(whipOkResponse());

    const session = await publishWhip({
      stream: makeFakeStream([makeFakeTrack("video")]),
      endpoint: ENDPOINT,
      createPeer: () => pc,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await session.stop();

    const deleteCall = fetchImpl.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCall?.[0]).toBe("https://whip.example/resource/abc");
    expect(calls.close).toHaveBeenCalled();
  });

  it("WHIP 응답이 비-2xx면 throw하고 PeerConnection을 닫는다", async () => {
    const { pc, calls } = makeFakePeer();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, text: async () => "" } as unknown as Response);

    await expect(
      publishWhip({
        stream: makeFakeStream([makeFakeTrack("video")]),
        endpoint: ENDPOINT,
        createPeer: () => pc,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/송출|실패|WHIP/);

    expect(calls.close).toHaveBeenCalled();
  });
});
