"use client";

import * as React from "react";

// 시청자용 HLS 플레이어 — playback.hls를 재생한다(ADR-002: 영상은 Cloudflare 위임).
// 네이티브 HLS(사파리 등)는 <video src>, 그 외는 동적 import한 hls.js로 attach.
// CRITICAL: URL이 없거나(키 부재) 로드 실패 시 던지지 않고 graceful 자리로(R30).
// 컨트롤·상태는 토큰 색만(R20), 깜빡임은 .anim-livepulse가 reduced-motion을 존중(R29).

export interface HlsPlayerProps {
  /** 재생할 HLS(m3u8) URL. 비어 있으면 "연결을 기다리는 중" 자리. */
  src: string;
}

type Status = "loading" | "ready" | "error";

export function HlsPlayer({ src }: HlsPlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [status, setStatus] = React.useState<Status>("loading");
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!src) return; // 키 부재 → 아래 graceful 자리 렌더
    const video = videoRef.current;
    if (!video) return;

    setStatus("loading");
    let cancelled = false;
    let hls: { destroy: () => void } | null = null;

    // 네이티브 HLS 지원(주로 Safari) — 직접 src 지정.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      const onPlaying = () => !cancelled && setStatus("ready");
      const onError = () => !cancelled && setStatus("error");
      video.addEventListener("loadeddata", onPlaying);
      video.addEventListener("error", onError);
      return () => {
        cancelled = true;
        video.removeEventListener("loadeddata", onPlaying);
        video.removeEventListener("error", onError);
      };
    }

    // 그 외 — hls.js 동적 import(번들 분리). 실패는 graceful error로.
    import("hls.js")
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setStatus("error");
          return;
        }
        const inst = new Hls();
        hls = inst;
        inst.loadSource(src);
        inst.attachMedia(video);
        inst.on(Hls.Events.MANIFEST_PARSED, () => !cancelled && setStatus("ready"));
        inst.on(Hls.Events.ERROR, (_evt, data) => {
          if (!cancelled && data?.fatal) setStatus("error");
        });
      })
      .catch(() => !cancelled && setStatus("error"));

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src, attempt]);

  // 키 부재 — 연결 대기 자리(던지지 않음, R30).
  if (!src) {
    return (
      <div className="grid aspect-video place-items-center rounded-lg border border-border-token bg-bg-subtle text-center">
        <div className="flex flex-col items-center gap-2">
          <span
            aria-hidden="true"
            className="anim-livepulse size-2.5 rounded-full bg-fg-faint"
          />
          <p className="text-[13px] text-fg-muted">연결을 기다리는 중이에요…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-border-token">
      {/* 실제 재생 표면. 토큰 배경(색 하드코딩 금지, R20). */}
      <video
        ref={videoRef}
        className="aspect-video w-full bg-bg-subtle"
        controls
        playsInline
        aria-label="라이브 세미나 영상"
      />
      {status === "loading" && (
        <div
          role="status"
          className="absolute inset-0 grid place-items-center bg-bg-subtle/80"
        >
          <p className="text-[13px] text-fg-muted">불러오는 중이에요…</p>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-bg-subtle/90 text-center">
          <div className="flex flex-col items-center gap-2">
            <p className="text-[13px] text-fg-muted">
              재생을 시작할 수 없어요.
            </p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="rounded-sm border border-border-strong px-3 py-1 text-[12px] font-medium text-fg hover:bg-bg-hover"
            >
              다시 시도
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
