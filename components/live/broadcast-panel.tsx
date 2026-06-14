"use client";

import * as React from "react";
import { Radio, Video } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { publishWhip, type WhipSession } from "@/lib/whip";

// 발표자 브라우저 송출 패널 — 화면공유+마이크를 WHIP로 Cloudflare에 publish한다('use client' 섬, R32).
// CRITICAL: getDisplayMedia는 사용자 제스처에서만 — [송출 시작] 클릭으로 캡처를 시작한다.
// CRITICAL: 실패는 graceful — 권한 거부/미설정 시 던지지 않고 안내(R30). OBS 폴백은 상위가 표시.
// 종료(라이브 종료)는 상위가 이 컴포넌트를 언마운트 → 정리(stop)는 언마운트 effect에서.

type Status = "idle" | "connecting" | "live" | "error";

export interface BroadcastPanelProps {
  /** 발표자 /start 응답의 webRTC.url(WHIP publish). 없으면 브라우저 송출 불가(OBS 폴백 사용). */
  webRTCUrl: string | null;
}

export function BroadcastPanel({ webRTCUrl }: BroadcastPanelProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const whipRef = React.useRef<WhipSession | null>(null);
  const [status, setStatus] = React.useState<Status>("idle");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const teardown = React.useCallback(() => {
    const whip = whipRef.current;
    whipRef.current = null;
    if (whip) void Promise.resolve(whip.stop()).catch(() => {});
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());
  }, []);

  // 언마운트(=라이브 종료/이탈) 시 송출 정리.
  React.useEffect(() => teardown, [teardown]);

  function handleStop() {
    teardown();
    setStatus("idle");
  }

  async function handleStart() {
    if (!webRTCUrl) return;
    setStatus("connecting");
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      // 마이크는 best-effort — 거부돼도 화면만 송출한다.
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getAudioTracks().forEach((t) => stream.addTrack(t));
      } catch {
        // 마이크 없이 진행
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      // 발표자가 브라우저 UI에서 화면공유를 멈추면 송출도 멈춘다.
      stream.getVideoTracks()[0]?.addEventListener("ended", handleStop);

      whipRef.current = await publishWhip({ stream, endpoint: webRTCUrl });
      setStatus("live");
    } catch (e) {
      teardown();
      const denied = e instanceof Error && e.name === "NotAllowedError";
      setErrorMsg(
        denied
          ? "화면 공유 권한이 필요해요. 권한을 허용하고 다시 시도해주세요."
          : "송출 연결에 실패했어요. 다시 시도하거나 아래 OBS 정보로 송출해주세요.",
      );
      setStatus("error");
    }
  }

  // webRTC URL 부재 — 브라우저 송출 불가. 상위가 OBS 자격증명을 표시한다.
  if (!webRTCUrl) {
    return (
      <Card className="flex flex-col gap-1 p-4">
        <p className="text-[13px] font-semibold text-fg">발표자 송출</p>
        <p className="text-[13px] text-fg-muted">
          브라우저 송출을 쓸 수 없어요. 아래 OBS 정보로 송출해주세요.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-fg">발표자 송출</p>
        {status === "live" && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-busy">
            <span
              aria-hidden="true"
              className="anim-livepulse size-2 rounded-full bg-busy"
            />
            송출 중
          </span>
        )}
      </div>

      {/* 미리보기 — 본인 화면. 음소거(에코 방지). */}
      <video
        ref={videoRef}
        className="aspect-video w-full rounded-lg border border-border-token bg-bg-subtle"
        autoPlay
        muted
        playsInline
        aria-label="송출 미리보기"
      />

      {status !== "live" && (
        <div className="flex flex-col items-center gap-2">
          <Button onClick={handleStart} disabled={status === "connecting"}>
            {status === "connecting" ? (
              <Radio size={14} aria-hidden="true" />
            ) : (
              <Video size={14} aria-hidden="true" />
            )}
            {status === "connecting" ? "연결 중…" : "화면 공유로 송출 시작"}
          </Button>
          {errorMsg && (
            <p className="text-center text-[12px] text-busy">{errorMsg}</p>
          )}
        </div>
      )}
    </Card>
  );
}
