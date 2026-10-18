import { describe, expect, it } from "vitest";
import type { LocalAgentDeviceView, LocalAgentProviderStatus } from "@/types/local-agent";
import { chatSelection, rememberChatTarget, restoreChatTarget } from "../chat-selection";

function device(status: LocalAgentProviderStatus = "ready", models = [{ id: "c1", name: "Codex 첫 모델" }, { id: "c2", name: "Codex 다른 모델" }]): LocalAgentDeviceView {
  return { id: "pc", name: "내 PC", platform: "windows", online: true, lastSeenAt: null, leaseExpiresAt: null,
    providers: [
      { provider: "codex", status, models, quota: null, observedAt: "2026-10-18T00:00:00Z" },
      { provider: "claude", status: "ready", models: [{ id: "haiku", name: "Claude 모델" }], quota: null, observedAt: "2026-10-18T00:00:00Z" },
    ] };
}

describe("자유 대화 모델 선택", () => {
  it("처음 설정하지 않았을 때만 실제 첫 모델을 쓰고 수동 선택을 우선한다", () => {
    expect(chatSelection(device(), null)).toMatchObject({ provider: "codex", model: "c1" });
    expect(chatSelection(device(), { provider: "claude", model: "haiku" })).toMatchObject({ provider: "claude", model: "haiku" });
  });

  it.each([
    { name: "로그인 필요", status: "login_required" as const, models: [{ id: "c1", name: "Codex 첫 모델" }] },
    { name: "사용 한도", status: "limited" as const, models: [{ id: "c1", name: "Codex 첫 모델" }] },
    { name: "모델 삭제", status: "ready" as const, models: [{ id: "c2", name: "Codex 다른 모델" }] },
  ])("선택한 Codex가 $name 상태이면 다른 실제 모델로 자동 전환하지 않는다", ({ status, models }) => {
    expect(chatSelection(device(status, models), { provider: "codex", model: "c1" })).toBeNull();
  });

  it("같은 기기는 사라진 대상도 기억하고 새 기기에서만 실제 초기 모델을 고른다", () => {
    const target = rememberChatTarget(device(), null);
    expect(target).toEqual({ deviceId: "pc", provider: "codex", model: "c1" });
    expect(rememberChatTarget(device("limited"), target)).toEqual(target);
    const next = { ...device("limited"), id: "new-pc" };
    expect(rememberChatTarget(next, target)).toEqual({ deviceId: "new-pc", provider: "claude", model: "haiku" });
  });

  it("새로고침용 힌트는 대상만 복원하고 손상된 값은 사용하지 않는다", () => {
    expect(restoreChatTarget('{"deviceId":"pc","provider":"codex","model":"c1"}')).toEqual({ deviceId: "pc", provider: "codex", model: "c1" });
    for (const value of [null, "broken-json", '{"deviceId":"pc","provider":"other","model":"c1"}', '{"provider":"codex","model":"c1"}']) expect(restoreChatTarget(value)).toBeNull();
  });
});
