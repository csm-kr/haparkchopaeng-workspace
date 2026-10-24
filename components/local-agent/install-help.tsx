"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import type { ConnectorRelease } from "./client";
import { useLocalAgent } from "./provider";
import { bridgeArtifactKey, detectBridgePlatform } from "./bridge-release";
import { BridgeDownload, useBridgeTarget } from "./bridge-download";

type ReleaseLoad = { kind: "loading" } | { kind: "error" } | { kind: "ready"; releases: ConnectorRelease[] };

export function InstallHelp({ onBack }: { onBack?: () => void }) {
  const agent = useLocalAgent();
  const api = agent?.api;
  const [platform] = React.useState(detectBridgePlatform);
  const [load, setLoad] = React.useState<ReleaseLoad>({ kind: "loading" });
  const [revision, setRevision] = React.useState(0);
  const [intent, setIntent] = React.useState<string | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => { heading.current?.focus(); }, []);
  React.useEffect(() => {
    if (!api) return;
    let live = true;
    setLoad({ kind: "loading" });
    void api.downloads().then(result => {
      if (live) setLoad({ kind: "ready", releases: result.releases });
    }).catch(() => { if (live) setLoad({ kind: "error" }); });
    return () => { live = false; };
  }, [api, revision]);
  const target = useBridgeTarget(load.kind === "ready" ? load.releases : [], "install", platform);
  const key = target.release && target.url ? bridgeArtifactKey(target.release, target.url) : null;
  const requested = key !== null && intent === key;
  React.useLayoutEffect(() => { setIntent(null); }, [key]);
  return <section aria-label="AI 브릿지 설치" className="flex flex-col gap-3 rounded-md border border-border-token bg-bg-subtle p-4">
    <h3 ref={heading} tabIndex={-1} className="text-[14px] font-medium text-fg">AI 브릿지 설치</h3>
    <p className="text-[12px] leading-relaxed text-fg-muted">이 PC에 맞는 파일을 받아 설치한 뒤 연결해 주세요. 설치 파일을 받는 것만으로 웹에 연결되지는 않아요.</p>
    <BridgeDownload target={target} label="AI 브릿지 받기" onDownload={() => setIntent(key)} unavailable={<>
      <Button disabled variant="secondary">{load.kind === "loading" ? "설치 파일 확인 중…" : load.kind === "error" ? "설치 파일을 확인하지 못했어요" : "설치 파일 준비 중"}</Button>
      {(load.kind === "ready" || !target.platform) && <p className="text-[12px] text-fg-muted">{!target.platform ? "사용하는 PC의 운영체제를 선택해 주세요." : "이 환경의 설치 파일이 아직 배포되지 않았어요."}</p>}
    </>} />
    {load.kind === "error" && <Button variant="secondary" onClick={() => setRevision(value => value + 1)}>설치 파일 다시 확인</Button>}
    {requested && <p role="status" className="text-[12px] text-fg-muted">설치 파일을 요청했어요. 브라우저의 다운로드 목록을 확인해 주세요.</p>}
    {target.url && target.release && <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-fg-muted">
      <li>{target.release.platform === "macos" ? "받은 DMG 파일을 열고 AI 브릿지를 응용 프로그램 폴더로 옮겨 주세요." : target.release.platform === "windows" ? "받은 설치 파일을 열어 설치를 마친 뒤 AI 브릿지를 실행해 주세요." : "받은 .deb 파일을 소프트웨어 설치 앱에서 열어 설치한 뒤 앱 메뉴에서 AI 브릿지를 실행해 주세요."}</li>
      <li>아래 연결 버튼을 누르고 브라우저의 앱 열기 요청을 허용해 주세요.</li>
      <li>앱이 응답하면 웹에 표시되는 번호를 AI 브릿지에 입력해 주세요.</li>
    </ol>}
    <Button onClick={() => void agent?.start()}>설치 후 연결하기</Button>
    {onBack && !agent?.fallback && <Button variant="ghost" onClick={onBack}>연결 방법으로 돌아가기</Button>}
  </section>;
}
