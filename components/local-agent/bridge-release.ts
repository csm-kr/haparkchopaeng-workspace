import type { LocalAgentPlatform } from "@/types/local-agent";
import type { ConnectorRelease } from "./client";

function versionParts(value: string | null | undefined) {
  if (!value || value.length > 64) return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some(item => /^0\d+$/.test(item))) return null;
  return { core: match.slice(1, 4), prerelease };
}

function compareNumeric(a: string, b: string) {
  return a.length !== b.length ? Math.sign(a.length - b.length) : a === b ? 0 : a < b ? -1 : 1;
}

/** Installed relative to published: negative means an update is available. */
export function compareBridgeVersions(installed: string | null | undefined, published: string | null | undefined): number | null {
  const a = versionParts(installed), b = versionParts(published);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) {
    const order = compareNumeric(a.core[i], b.core[i]);
    if (order) return order;
  }
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const left = a.prerelease[i], right = b.prerelease[i];
    if (left === undefined || right === undefined) return left === undefined ? -1 : 1;
    if (left === right) continue;
    const numericLeft = /^\d+$/.test(left), numericRight = /^\d+$/.test(right);
    return numericLeft && numericRight ? compareNumeric(left, right) : numericLeft !== numericRight ? numericLeft ? -1 : 1 : left < right ? -1 : 1;
  }
  return 0;
}

export function bridgeReleaseFor(releases: ConnectorRelease[], platform: LocalAgentPlatform | "", architecture: string | null | undefined): ConnectorRelease | null {
  const matching = releases.filter(item => item.platform === platform && versionParts(item.version)
    && (architecture || platform !== "macos" || item.architecture === "universal"));
  if (!architecture && new Set(matching.map(item => item.architecture ?? "")).size > 1) return null;
  const compatible = matching.filter(item => !architecture || !item.architecture || item.architecture === "universal" || item.architecture === architecture);
  return compatible.reduce<ConnectorRelease | null>((latest, item) => !latest || compareBridgeVersions(item.version, latest.version)! > 0 ? item : latest, null);
}

export function safeBridgeDownloadUrl(value: string | undefined, origin: string): string | null {
  if (!value || /[\\\s]/.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\x00-\x20]/.test(decoded) || decoded.split(/[/?#]/).includes("..")) return null;
    const relative = value.startsWith("/") && !value.startsWith("//") && !decoded.startsWith("//");
    if (!relative && !value.startsWith("https://")) return null;
    const url = new URL(value, origin);
    return !url.username && !url.password && (url.protocol === "https:" || (relative && url.origin === origin && url.protocol === "http:")) ? url.href : null;
  } catch { return null; }
}

export type BridgeChip = "arm64" | "x64";

/** Only Chromium reports the CPU family; other browsers resolve to null. */
export async function detectBridgeChip(): Promise<BridgeChip | null> {
  const data = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
  try {
    const architecture = (await data?.getHighEntropyValues?.(["architecture"]))?.architecture;
    return architecture === "arm" ? "arm64" : architecture === "x86" ? "x64" : null;
  } catch { return null; }
}

export function detectBridgePlatform(): LocalAgentPlatform | "" {
  if (typeof navigator === "undefined" || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return "";
  if (/Windows/i.test(navigator.userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) return "macos";
  return /Linux|Ubuntu/i.test(navigator.userAgent) ? "linux" : "";
}
