"use client";

import * as React from "react";
import { Download } from "lucide-react";
import type { LocalAgentPlatform } from "@/types/local-agent";
import type { ConnectorRelease } from "./client";
import { bridgeReleaseFor, detectBridgeChip, detectBridgePlatform, safeBridgeDownloadUrl, type BridgeChip } from "./bridge-release";

const PLATFORM_NAMES: Record<LocalAgentPlatform, string> = { windows: "Windows", macos: "Mac", linux: "Ubuntu" };
const CHIP_NAMES: Record<BridgeChip, string> = { arm64: "Apple Silicon", x64: "Intel" };
const selectClass = "min-h-10 w-full rounded-sm border border-border-strong bg-bg-elevated px-3 text-[13px] text-fg focus:outline-none focus:ring-[3px] focus:ring-accent-soft";

export type BridgeTarget = ReturnType<typeof useBridgeTarget>;

/** One file for this computer: a manual choice, then the connected app's chip, then the browser's, then Apple Silicon. */
export function useBridgeTarget(releases: ConnectorRelease[], scope: string, basePlatform: LocalAgentPlatform | "", knownChip?: BridgeChip | null) {
  const [manual, setManual] = React.useState<{ scope: string; platform: LocalAgentPlatform | ""; chip?: BridgeChip } | null>(null);
  const [browserPlatform] = React.useState(detectBridgePlatform);
  const [browserChip, setBrowserChip] = React.useState<BridgeChip | null>(null);
  React.useEffect(() => {
    let live = true;
    void detectBridgeChip().then(chip => { if (live) setBrowserChip(chip); });
    return () => { live = false; };
  }, []);
  const choice = manual?.scope === scope ? manual : null;
  const platform = choice ? choice.platform : basePlatform;
  const inferredChip = platform === basePlatform ? knownChip ?? (platform === browserPlatform ? browserChip : null) : null;
  const chip = choice?.chip ?? inferredChip ?? (platform === "macos" ? "arm64" : null);
  const release = bridgeReleaseFor(releases, platform, chip);
  const url = typeof window === "undefined" ? null : safeBridgeDownloadUrl(release?.url, window.location.origin);
  const chips = Array.from(new Set(releases.filter(item => item.platform === platform).map(item => item.architecture)
    .filter((value): value is BridgeChip => value === "arm64" || value === "x64")));
  const chipUnknown = platform === "macos" && !choice?.chip && !inferredChip;
  return { platform, chip, release, url, chips, chipUnknown,
    choosePlatform: (value: LocalAgentPlatform | "") => setManual({ scope, platform: value }),
    chooseChip: (value: BridgeChip) => setManual({ scope, platform, chip: value }) };
}

/** The single download action; other operating systems and chips stay folded under a text toggle. */
export function BridgeDownload({ target, label, unavailable, onDownload }: {
  target: BridgeTarget;
  label: string;
  unavailable?: React.ReactNode;
  onDownload?: () => void;
}) {
  const noticeId = React.useId();
  const [startOpen] = React.useState(!target.platform);
  const { platform, release, url, chips } = target;
  const selectableChips: BridgeChip[] = platform === "macos" ? ["arm64", "x64"] : chips;
  const unsigned = release?.unsigned === true;
  const chipName = platform === "macos" && (release?.architecture === "arm64" || release?.architecture === "x64") ? ` · ${CHIP_NAMES[release.architecture]}` : "";
  return <div className="flex flex-col gap-2">
    {url && release && platform ? <>
      <a href={url} download={release.filename || undefined} aria-describedby={unsigned ? noticeId : undefined} onClick={onDownload}
        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-sm bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft">
        <Download size={14} aria-hidden="true" />{label}
      </a>
      <p className="text-center text-[11px] text-fg-subtle">{PLATFORM_NAMES[platform]}{chipName}용 · {release.version}</p>
      {unsigned && <p id={noticeId} className="text-[12px] leading-relaxed text-fg-muted">
        <span className="font-medium text-fg">테스트 버전 · 게시자 서명 없음</span>
        {platform === "windows" && " · Windows에서 게시자 확인 안내가 나올 수 있어요."}
        {platform === "macos" && " · 처음 열 때 막히면 시스템 설정 > 개인정보 보호 및 보안에서 '그래도 열기'를 눌러 주세요."}
      </p>}
    </> : unavailable}
    {target.chipUnknown && <p className="text-[11px] leading-relaxed text-fg-muted">칩을 확인하지 못해 Apple Silicon을 기본으로 선택했어요. Intel Mac이면 아래에서 바꿔 주세요.</p>}
    <details open={startOpen} className="text-[12px] text-fg-muted">
      <summary className="cursor-pointer select-none rounded-sm py-1 hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft">
        {!platform ? "운영체제 선택" : platform === "macos" ? "Intel Mac이나 다른 컴퓨터용 파일" : "다른 컴퓨터용 파일"}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <label className="flex flex-col gap-1">운영체제
          <select value={platform} onChange={event => target.choosePlatform(event.target.value === "windows" || event.target.value === "macos" || event.target.value === "linux" ? event.target.value : "")} className={selectClass}>
            <option value="">운영체제를 선택하세요</option>
            <option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Ubuntu · 데스크톱</option>
          </select>
        </label>
        {selectableChips.length > 1 && <label className="flex flex-col gap-1">칩 종류
          <select value={target.chip ?? ""} onChange={event => target.chooseChip(event.target.value === "x64" ? "x64" : "arm64")} className={selectClass}>
            {selectableChips.map(chip => <option key={chip} value={chip}>{platform === "macos" ? (chip === "arm64" ? "Apple Silicon (M1 이후)" : "Intel") : (chip === "arm64" ? "ARM64" : "Intel / AMD 64비트")}</option>)}
          </select>
        </label>}
      </div>
    </details>
  </div>;
}
