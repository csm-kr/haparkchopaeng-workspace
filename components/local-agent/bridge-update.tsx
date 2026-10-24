"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import type { ConnectorRelease } from "./client";
import { useLocalAgent } from "./provider";
import { bridgeArtifactKey, bridgeReleaseFor, compareBridgeVersions, detectBridgePlatform } from "./bridge-release";
import { BridgeDownload, useBridgeTarget } from "./bridge-download";

export function BridgeUpdateInfo({ onReconnect }: { onReconnect?: () => void }) {
  const agent = useLocalAgent();
  const api = agent?.api;
  const [releases, setReleases] = React.useState<ConnectorRelease[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [browserPlatform] = React.useState(detectBridgePlatform);
  const [intent, setIntent] = React.useState<string | null>(null);
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
  const { release, url } = target;
  const key = release && url ? bridgeArtifactKey(release, url) : null;
  React.useLayoutEffect(() => { setIntent(null); }, [key]);
  if (!agent) return null;
  const installed = agent.phase === "connected" ? device?.bridgeVersion : null;
  const installedReleases = releases.filter(item => !!device?.bridgeArchitecture || !item.architecture || item.architecture === "universal");
  const installedRelease = device ? bridgeReleaseFor(installedReleases, device.platform, device.bridgeArchitecture) : null;
  const comparison = compareBridgeVersions(installed, installedRelease?.version);
  const outdated = state === "ready" && comparison !== null && comparison < 0;
  const unknown = state === "ready" && comparison === null;
  const requested = key !== null && intent === key;
  const status = state === "loading" ? "최신 버전 확인 중…" : state === "error" ? "최신 버전을 확인하지 못했어요" : !installedRelease ? "연결된 PC의 최신 버전을 확인할 수 없어요" : comparison === 0 ? "최신 버전이에요" : comparison !== null && comparison > 0 ? "설치 버전이 더 최신이에요" : outdated ? "새 버전으로 업데이트할 수 있어요" : "설치 버전을 확인할 수 없어요";
  const download = <>
    <BridgeDownload target={target} label={outdated || unknown ? "업데이트 받기" : "설치 파일 받기"} onDownload={() => setIntent(key)} unavailable={state === "ready" ? <p className="text-[12px] text-fg-muted">이 환경의 설치 파일을 준비 중이에요</p> : undefined} />
    {requested && <>
      <p role="status" className="text-[12px] leading-relaxed text-fg-muted">설치 파일을 요청했어요. 브라우저의 다운로드 목록에서 파일을 열어 설치해 주세요. 연결된 앱이 새 버전을 알려 주면 표시도 바뀌어요.</p>
      {onReconnect && <Button onClick={onReconnect}>설치 후 다시 연결</Button>}
    </>}
  </>;
  return <section aria-label="AI 브릿지 버전" className="flex flex-col gap-2 border-t border-border-token pt-3">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="text-[12px] font-medium text-fg">AI 브릿지</span>
      {installed && <div className="flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-fg-subtle"><span>설치 {installed}</span>{state === "ready" && installedRelease && <span>최신 {installedRelease.version}</span>}</div>}
    </div>
    <p role="status" className="text-[12px] text-fg-muted">{status}</p>
    {state === "ready" && (outdated || unknown ? download : <details className="text-[12px] text-fg-muted"><summary className="cursor-pointer rounded-sm py-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft">설치 파일 · 다른 컴퓨터에 설치</summary><div className="mt-2 flex flex-col gap-2">{download}</div></details>)}
    {state === "error" && <Button variant="ghost" size="sm" onClick={() => setRevision(value => value + 1)}>다시 시도</Button>}
  </section>;
}
