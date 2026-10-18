import type { LocalAgentDeviceView, LocalAgentEffort, LocalAgentModel } from "@/types/local-agent";
import type { ModelSelection } from "./provider";

export const EFFORT_LABELS: Record<LocalAgentEffort, string> = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };

export interface ChatTarget extends ModelSelection { deviceId: string }

/** A catalogue refresh may invalidate a target, but must not silently replace it. */
export function rememberChatTarget(device: LocalAgentDeviceView, previous: ChatTarget | null): ChatTarget | null {
  if (previous?.deviceId === device.id) return previous;
  const first = chatSelection(device, null);
  return first ? { deviceId: device.id, provider: first.provider, model: first.model } : null;
}

export function restoreChatTarget(saved: string | null): ChatTarget | null {
  try {
    const value = JSON.parse(saved ?? "null");
    return value && typeof value.deviceId === "string" && !!value.deviceId && typeof value.model === "string" && !!value.model
      && (value.provider === "codex" || value.provider === "claude")
      ? { deviceId: value.deviceId, provider: value.provider, model: value.model } : null;
  } catch { return null; }
}

export function modelEfforts(model?: LocalAgentModel): LocalAgentEffort[] {
  return model?.reasoningEfforts ?? [];
}

/** Default only an unset target; an unavailable previous target must never fail over. */
export function chatSelection(device: LocalAgentDeviceView | null | undefined, selected: ModelSelection | null | undefined, effort: LocalAgentEffort = "medium") {
  const models = device?.providers.flatMap(provider => provider.status === "ready" ? provider.models.map(model => ({ provider: provider.provider, model })) : []) ?? [];
  const option = selected ? models.find(item => item.provider === selected.provider && item.model.id === selected.model) : models[0];
  if (!option) return null;
  const efforts = modelEfforts(option.model);
  return { provider: option.provider, model: option.model.id, ...(efforts.length ? {
    effort: efforts.includes(effort) ? effort : efforts.includes("medium") ? "medium" as const : efforts[0],
  } : {}) };
}
