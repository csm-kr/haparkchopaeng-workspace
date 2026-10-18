"use client";

import * as React from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import type { LocalAgentPlatform } from "@/types/local-agent";
import type { ConnectorRelease } from "./client";
import { useLocalAgent } from "./provider";
import { bridgeReleaseFor, compareBridgeVersions, detectBridgePlatform, safeBridgeDownloadUrl } from "./bridge-release";

export function BridgeUpdateInfo() {
  const agent = useLocalAgent();
  const api = agent?.api;
  const [releases, setReleases] = React.useState<ConnectorRelease[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [browserPlatform, setBrowserPlatform] = React.useState<LocalAgentPlatform | "">(detectBridgePlatform);
  const [manualChip, setManualChip] = React.useState<{ scope: string; value: string } | null>(null);
  const [downloaded, setDownloaded] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const noticeId = React.useId();
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
  if (!agent) return null;
  const device = agent.device;
  const platform = device?.platform ?? browserPlatform;
  const scope = `${device?.id ?? "browser"}:${platform}`;
  const architecture = device?.bridgeArchitecture ?? (manualChip?.scope === scope ? manualChip.value : undefined);
  const chips = Array.from(new Set(releases.filter(item => item.platform === platform).map(item => item.architecture).filter((value): value is string => value === "arm64" || value === "x64")));
  const needsChipChoice = !device?.bridgeArchitecture && (chips.length > 1 || (platform === "macos" && chips.length > 0));
  const release = bridgeReleaseFor(releases, platform, architecture);
  const url = typeof window === "undefined" ? null : safeBridgeDownloadUrl(release?.url, window.location.origin);
  const installed = agent.phase === "connected" ? device?.bridgeVersion : null;
  const comparison = compareBridgeVersions(installed, release?.version);
  const canUpdate = state === "ready" && !!url && (comparison === null || comparison < 0);
  return <section aria-label="AI 브릿지 버전" className="flex flex-col gap-2 border-t border-border-token pt-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] font-medium text-fg">AI 브릿지</span>
      <button type="button" aria-label="업데이트 확인" disabled={state === "loading"} onClick={() => setRevision(value => value + 1)} className="inline-flex min-h-8 items-center gap-1 rounded-sm px-1.5 text-[11px] text-fg-muted hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:opacity-50"><RefreshCw size={12} aria-hidden="true" />다시 확인</button>
    </div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-fg-subtle">
      <span>{installed ? `설치 ${installed}` : "설치 버전 미확인"}</span>
      {state === "ready" && release && <span>최신 {release.version}</span>}
    </div>
    {!device?.platform && !browserPlatform && <label className="flex flex-col gap-1 text-[12px] text-fg-muted">업데이트할 운영체제
      <select value={browserPlatform} onChange={event => setBrowserPlatform(event.target.value as LocalAgentPlatform | "")} className="min-h-10 rounded-sm border border-border-strong bg-bg-elevated px-2 text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"><option value="">운영체제를 선택하세요</option><option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Ubuntu · 데스크톱</option></select>
    </label>}
    {needsChipChoice && <label className="flex flex-col gap-1 text-[12px] text-fg-muted">업데이트할 칩 종류
      <select value={architecture ?? ""} onChange={event => setManualChip({ scope, value: event.target.value })} className="min-h-10 rounded-sm border border-border-strong bg-bg-elevated px-2 text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"><option value="">칩 종류를 선택하세요</option>{chips.map(chip => <option key={chip} value={chip}>{chip === "arm64" ? "Apple Silicon / ARM64" : "Intel / AMD 64비트"}</option>)}</select>
    </label>}
    <p role="status" className="text-[12px] text-fg-muted">{state === "loading" ? "최신 버전 확인 중…" : state === "error" ? "최신 버전을 확인하지 못했어요" : !release || !url ? (!architecture && needsChipChoice ? "칩 종류를 선택하면 업데이트 파일을 확인할 수 있어요" : "이 환경의 설치 파일을 준비 중이에요") : comparison === 0 ? "최신 버전이에요" : comparison !== null && comparison > 0 ? "설치 버전이 더 최신이에요" : installed ? "새 버전으로 업데이트할 수 있어요" : "최신 설치 파일로 업데이트하면 앱 버전도 확인할 수 있어요"}</p>
    {canUpdate && <>
      {release?.unsigned && <p id={noticeId} className="text-[11px] leading-relaxed text-fg-subtle">테스트 버전 · 게시자 서명 없음{platform === "windows" ? " · Windows 게시자 확인 안내가 나올 수 있어요." : platform === "macos" ? " · macOS 보안 확인으로 실행이 제한될 수 있어요." : ""}</p>}
      <a href={url!} download={release?.filename} aria-describedby={release?.unsigned ? noticeId : undefined} onClick={() => setDownloaded(true)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-sm border border-border-strong bg-bg-elevated px-3 text-[12px] font-medium text-fg hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"><Download size={13} aria-hidden="true" />업데이트 받기</a>
      {downloaded && <p className="text-[12px] leading-relaxed text-fg-muted">다운로드한 설치 파일을 열면 기존 앱을 업데이트할 수 있어요. 설치를 마친 뒤 웹의 AI 연결을 다시 눌러 주세요. 앱이 새 버전을 알려 주면 이 표시도 바뀌어요.</p>}
    </>}
    {state === "error" && <Button variant="ghost" size="sm" onClick={() => setRevision(value => value + 1)}>다시 시도</Button>}
  </section>;
}
