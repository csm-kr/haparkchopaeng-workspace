import type { LocalAgentProviderSnapshot } from "@/types/local-agent";
import type { QuotaWindowView } from "./quota-badge";
import type { ConnectionPhase } from "./provider";

export const providerName = { codex: "Codex", claude: "Claude Code" } as const;
export const providerStatus = { ready: "사용 가능", login_required: "로그인 필요", not_installed: "설치 필요", limited: "한도 도달", error: "상태 확인 필요" } as const;
export const phaseLabel: Record<ConnectionPhase, string> = {
  loading: "연결 확인 중", idle: "AI 연결", creating: "연결 준비 중", opening: "AI 브릿지 여는 중",
  awaiting_code: "번호 입력 대기", connected: "내 PC 연결됨", offline: "다시 연결", cancelled: "AI 연결", expired: "다시 연결", error: "AI 연결", login_required: "로그인 필요",
};

function shortLabel(label: string, fallback: string) {
  if (/5\s*(시간|h)/i.test(label)) return "5h";
  if (/7\s*(일|d)|weekly/i.test(label)) return "7d";
  return label.length <= 5 ? label : fallback;
}

export function quotaWindows(snapshot: LocalAgentProviderSnapshot): QuotaWindowView[] {
  if (snapshot.status !== "ready" && snapshot.status !== "limited") return [];
  const quotaObservedAt = snapshot.quotaObservedAt ?? snapshot.observedAt;
  const observed = Number.isFinite(Date.parse(quotaObservedAt)) ? quotaObservedAt : null;
  const stale = !observed || Date.now() - Date.parse(observed) > 90000;
  const windows = [
    { value: snapshot.quota?.short, fallback: "단기" },
    { value: snapshot.quota?.weekly, fallback: "주간" },
  ].flatMap(({ value, fallback }) => value ? [{
    id: shortLabel(value.label, fallback), label: value.label,
    remainingPercent: value.remainingPercent,
    resetsAt: value.resetsAt, observedAt: observed,
    freshness: value.remainingPercent === null ? "unknown" as const : stale ? "stale" as const : "fresh" as const,
  }] : []);
  return windows.length ? windows : [{ id: "한도", label: "구독 한도", remainingPercent: null, resetsAt: null, observedAt: observed, freshness: "unknown" }];
}
