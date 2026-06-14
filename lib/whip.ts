// WHIP(WebRTC-HTTP Ingestion) publish 클라이언트 — 발표자 브라우저 송출용.
// 브라우저 WebRTC로 캡처한 스트림을 Cloudflare Stream Live의 webRTC.url(WHIP)에 publish한다.
// 외부 의존성 없이 SDP 교환만 한다. 테스트를 위해 RTCPeerConnection·fetch를 주입 가능하게 한다(기본은 전역).

export interface WhipSession {
  /** 송출 중지 — WHIP 리소스 DELETE(best-effort) + PeerConnection 종료. 멱등. */
  stop(): Promise<void>;
}

export interface PublishWhipOptions {
  stream: MediaStream;
  /** Cloudflare Live Input의 webRTC.url(WHIP publish 엔드포인트). */
  endpoint: string;
  createPeer?: () => RTCPeerConnection;
  fetchImpl?: typeof fetch;
}

export async function publishWhip({
  stream,
  endpoint,
  createPeer = () => new RTCPeerConnection(),
  fetchImpl = globalThis.fetch.bind(globalThis),
}: PublishWhipOptions): Promise<WhipSession> {
  const pc = createPeer();
  try {
    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    const sdp = pc.localDescription?.sdp ?? offer.sdp ?? "";
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: sdp,
    });
    if (!res.ok) {
      throw new Error(`WHIP 송출 연결 실패 (${res.status})`);
    }

    const answer = await res.text();
    const location = res.headers.get("Location");
    await pc.setRemoteDescription({ type: "answer", sdp: answer });

    let stopped = false;
    return {
      async stop() {
        if (stopped) return;
        stopped = true;
        if (location) {
          try {
            await fetchImpl(new URL(location, endpoint).toString(), {
              method: "DELETE",
            });
          } catch {
            // best-effort — PeerConnection을 닫으면 어차피 송출은 끊긴다.
          }
        }
        pc.close();
      },
    };
  } catch (e) {
    pc.close();
    throw e;
  }
}

/** ICE 후보 수집이 끝날 때까지 대기(non-trickle). 이미 완료면 즉시 resolve. */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onChange);
    // 안전장치: complete로 전이하지 않는 브라우저 대비 — 타임아웃 후 가진 후보로 진행.
    setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }, 2000);
  });
}
