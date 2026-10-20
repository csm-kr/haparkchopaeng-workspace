"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import type { ConnectorRelease } from "./client";
import { useLocalAgent } from "./provider";
import { detectBridgePlatform } from "./bridge-release";
import { BridgeDownload, useBridgeTarget } from "./bridge-download";

export function InstallHelp() {
  const agent = useLocalAgent();
  const api = agent?.api;
  const [releases, setReleases] = React.useState<ConnectorRelease[]>([]);
  const [platform] = React.useState(detectBridgePlatform);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  React.useEffect(() => {
    if (!api) return;
    let live = true;
    void api.downloads().then((result) => { if (live) { setReleases(result.releases); setState("ready"); } }).catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [api]);
  const target = useBridgeTarget(releases, "install", platform);
  return <div className="flex flex-col gap-3 rounded-md border border-border-token bg-bg-subtle p-4">
    <p className="text-[14px] font-medium text-fg">AI 브릿지가 열리지 않았나요?</p>
    <p className="text-[12px] leading-relaxed text-fg-muted">
      처음이라면 AI 브릿지를 설치해 주세요. 설치 후 AI 브릿지가 응답하면 이 화면에서 이어져요.
      {agent?.deepLink && <> 이미 설치했다면 <a href={agent.deepLink} className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft">AI 브릿지 다시 열기</a></>}
    </p>
    <BridgeDownload target={target} label="AI 브릿지 받기" unavailable={<>
      <Button disabled variant="secondary">{state === "loading" ? "설치 파일 확인 중…" : state === "error" ? "설치 파일을 확인하지 못했어요" : "설치 파일 준비 중"}</Button>
      {(!target.platform || state === "ready") && <p className="text-[12px] text-fg-muted">{!target.platform ? "사용하는 PC의 운영체제를 선택해 주세요." : "이 환경의 설치 파일이 아직 배포되지 않았어요."}</p>}
    </>} />
  </div>;
}
