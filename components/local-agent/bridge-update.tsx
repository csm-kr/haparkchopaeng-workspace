"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import type { ConnectorRelease } from "./client";
import { useLocalAgent } from "./provider";
import { compareBridgeVersions, detectBridgePlatform } from "./bridge-release";
import { BridgeDownload, useBridgeTarget } from "./bridge-download";

/** One action slot: download the update, then (when the host can) reconnect the freshly installed app. */
export function BridgeUpdateInfo({ onReconnect }: { onReconnect?: () => void }) {
  const agent = useLocalAgent();
  const api = agent?.api;
  const [releases, setReleases] = React.useState<ConnectorRelease[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [browserPlatform] = React.useState(detectBridgePlatform);
  const [downloaded, setDownloaded] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    if (!api) return;
    let current = true;
    setState("loading");
    void api.downloads().then(result => {
      if (current) { setReleases(result.releases); setState("ready"); }
    }).catch(() => { if (current) setState("error"); });
    return () => { current = false; };
  }, [api, revision]);
  React.useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setRevision(value => value + 1); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const device = agent?.device;
  const platform = device?.platform ?? browserPlatform;
  const target = useBridgeTarget(releases, `${device?.id ?? "browser"}:${platform}`, platform, device?.bridgeArchitecture);
  if (!agent) return null;
  const { release, url } = target;
  const installed = agent.phase === "connected" ? device?.bridgeVersion : null;
  const comparison = compareBridgeVersions(installed, release?.version);
  const outdated = state === "ready" && !(comparison !== null && comparison >= 0);
  const status = state === "loading" ? "최신 버전 확인 중…" : state === "error" ? "최신 버전을 확인하지 못했어요" : !release || !url ? "이 환경의 설치 파일을 준비 중이에요" : comparison === 0 ? "최신 버전이에요" : comparison !== null && comparison > 0 ? "설치 버전이 더 최신이에요" : installed ? "새 버전으로 업데이트할 수 있어요" : null;
  return <section aria-label="AI 브릿지 버전" className="flex flex-col gap-2 border-t border-border-token pt-3">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="text-[12px] font-medium text-fg">AI 브릿지</span>
      {installed && <div className="flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-fg-subtle">
        <span>설치 {installed}</span>
        {state === "ready" && release && <span>최신 {release.version}</span>}
      </div>}
    </div>
    {status && <p role="status" className="text-[12px] text-fg-muted">{status}</p>}
    {outdated && (downloaded && onReconnect && url ? <>
      <p className="text-[12px] leading-relaxed text-fg-muted">다운로드한 파일로 설치를 마친 뒤 눌러 주세요. 승인했던 기기라면 바로 이어져요.</p>
      <Button onClick={onReconnect}>설치 후 다시 연결</Button>
      <a href={url} download={release?.filename} className="self-center text-[12px] text-fg-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft">설치 파일 다시 받기</a>
    </> : <>
      <BridgeDownload target={target} label="업데이트 받기" onDownload={() => setDownloaded(true)} />
      {downloaded && <p className="text-[12px] leading-relaxed text-fg-muted">다운로드한 설치 파일을 열면 기존 앱을 업데이트할 수 있어요. 설치를 마친 뒤 웹의 AI 연결을 다시 눌러 주세요. 앱이 새 버전을 알려 주면 이 표시도 바뀌어요.</p>}
    </>)}
    {state === "error" && <Button variant="ghost" size="sm" onClick={() => setRevision(value => value + 1)}>다시 시도</Button>}
  </section>;
}
