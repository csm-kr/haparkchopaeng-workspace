import { describe, expect, it } from "vitest";
import type { LocalAgentProviderSnapshot } from "@/types/local-agent";
import { quotaWindows } from "../presentation";

function provider(overrides: Partial<LocalAgentProviderSnapshot> = {}): LocalAgentProviderSnapshot {
  return { provider: "claude", status: "ready", models: [{ id: "model", name: "감지된 모델" }], observedAt: new Date().toISOString(),
    quota: { short: null, weekly: { label: "7일 한도", remainingPercent: 44, resetsAt: null } }, ...overrides };
}

describe("공급자 사용량 표시 정규화", () => {
  it("새 카탈로그 이벤트가 오래된 사용량의 관측 시각을 새것으로 바꾸지 않는다", () => {
    const observedAt = new Date(Date.now() - 91000).toISOString();
    const snapshot = provider({ quotaObservedAt: observedAt });
    const windows = quotaWindows(snapshot);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ id: "7d", observedAt, freshness: "stale" });
    expect(snapshot.models).toHaveLength(1);
  });

  it("기존 공급자와 미제공 사용량은 호환하고 없는 5시간 창을 만들지 않는다", () => {
    const snapshot = provider();
    expect(quotaWindows(snapshot)).toEqual([expect.objectContaining({ id: "7d", observedAt: snapshot.observedAt, freshness: "fresh" })]);
    expect(quotaWindows(provider({ quota: null }))).toEqual([expect.objectContaining({ id: "한도", remainingPercent: null, freshness: "unknown" })]);
  });

  it("인증이 사라진 공급자는 이전 사용량과 관측 시각을 표시하지 않는다", () => {
    expect(quotaWindows(provider({ status: "login_required", quotaObservedAt: new Date().toISOString() }))).toEqual([]);
  });
});
