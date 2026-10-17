"use client";

import * as React from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui";
import type { LocalAgentPlatform } from "@/types/local-agent";
import type { ConnectorRelease } from "./client";
import { useLocalAgent } from "./provider";

function detectPlatform(): LocalAgentPlatform | "" {
  if (typeof navigator === "undefined" || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return "";
  if (/Windows/i.test(navigator.userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) return "macos";
  if (/Linux|Ubuntu/i.test(navigator.userAgent)) return "linux";
  return "";
}

function downloadUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return !url.username && !url.password && (url.protocol === "https:" || (url.origin === window.location.origin && url.protocol === "http:")) ? url.href : null;
  } catch { return null; }
}

export function InstallHelp() {
  const agent = useLocalAgent();
  const api = agent?.api;
  const [releases, setReleases] = React.useState<ConnectorRelease[]>([]);
  const [platform, setPlatform] = React.useState<LocalAgentPlatform | "">(detectPlatform);
  const [architecture, setArchitecture] = React.useState("");
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  React.useEffect(() => {
    if (!api) return;
    let live = true;
    void api.downloads().then((result) => { if (live) { setReleases(result.releases); setState("ready"); } }).catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [api]);
  const matching = releases.filter((release) => release.platform === platform);
  const release = matching.length === 1 ? matching[0] : matching.find((entry) => entry.architecture === architecture);
  const url = downloadUrl(release?.url);
  return <div className="flex flex-col gap-3 rounded-md border border-border-token bg-bg-subtle p-4">
    <p className="text-[14px] font-medium text-fg">연결기가 열리지 않았나요?</p>
    <p className="text-[12px] leading-relaxed text-fg-muted">응답이 없어도 설치 여부를 확정할 수 없어요. 브라우저의 앱 열기 창을 확인하거나, 처음이라면 연결기를 한 번 설치해 주세요.</p>
    {agent?.deepLink && <a href={agent.deepLink} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-sm border border-border-strong bg-bg-elevated px-3 text-[13px] font-medium text-fg hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"><ExternalLink size={14} aria-hidden="true" />연결기 다시 열기</a>}
    <label className="flex flex-col gap-1 text-[12px] text-fg-muted">설치할 운영체제
      <select value={platform} onChange={(event) => { setPlatform(event.target.value as LocalAgentPlatform | ""); setArchitecture(""); }}
        className="min-h-10 w-full rounded-sm border border-border-strong bg-bg-elevated px-3 text-[13px] text-fg focus:outline-none focus:ring-[3px] focus:ring-accent-soft">
        <option value="">운영체제를 선택하세요</option>
        <option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Ubuntu · 데스크톱</option>
      </select>
    </label>
    {matching.length > 1 && <label className="flex flex-col gap-1 text-[12px] text-fg-muted">칩 종류
      <select value={architecture} onChange={(event) => setArchitecture(event.target.value)} className="min-h-10 rounded-sm border border-border-strong bg-bg-elevated px-3 text-[13px] text-fg">
        <option value="">칩 종류를 선택하세요</option>
        {matching.map((entry) => <option key={entry.architecture} value={entry.architecture}>{entry.architecture === "arm64" ? "Apple Silicon / ARM64" : entry.architecture === "x64" ? "Intel / AMD 64비트" : entry.architecture}</option>)}
      </select>
    </label>}
    {url ? <>
      <a href={url} download={release?.filename || undefined} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-sm bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"><Download size={14} aria-hidden="true" />연결기 다운로드</a>
      <p className="text-[12px] leading-relaxed text-fg-muted">다운로드한 파일을 열어 설치해 주세요. 설치 후 연결기가 응답하면 이 화면에서 이어져요. macOS·Ubuntu는 설치 후 앱을 처음 열어야 할 수 있어요.</p>
      <span className="font-mono text-[11px] text-fg-subtle">{release?.version}</span>
    </> : <>
      <Button disabled variant="secondary">{state === "loading" ? "설치 파일 확인 중…" : state === "error" ? "설치 파일을 확인하지 못했어요" : "설치 파일 준비 중"}</Button>
      <p className="text-[12px] text-fg-muted">{!platform ? "사용하는 PC의 운영체제를 선택해 주세요." : "이 환경의 설치 파일이 아직 배포되지 않았어요."}</p>
    </>}
  </div>;
}
