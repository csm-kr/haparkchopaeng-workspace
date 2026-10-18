import type { AgentSeminarDraft, AgentTaskInput, AgentTaskView } from "@/types/agent-task";
import type { LocalAgentEffort, LocalAgentProvider } from "@/types/local-agent";

export interface TaskExecution { deviceId: string; provider: LocalAgentProvider; model: string; effort?: LocalAgentEffort }
export interface TaskControl { action: "cancel" | "resume" | "steer"; expectedVersion: number; goal?: string; deviceId?: string; provider?: LocalAgentProvider; model?: string; effort?: LocalAgentEffort }
export class AgentApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
async function request<T>(path: string, input?: unknown): Promise<T> {
  const response = await fetch(`/api/agent/tasks${path}`, { method: input === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", ...(input === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }) });
  const body = await response.json();
  if (!response.ok) throw new AgentApiError(response.status, body?.error?.code ?? "UNKNOWN", typeof body?.error?.message === "string" ? body.error.message : "작업을 완료하지 못했어요. 잠시 뒤 다시 시도해주세요.");
  return body.data as T;
}
export const agentTaskApi = {
  list: (conversationId?: string) => request<AgentTaskView[]>(conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ""),
  create: (input: AgentTaskInput) => request<AgentTaskView>("", input),
  get: (id: string) => request<AgentTaskView>(`/${encodeURIComponent(id)}`),
  control: (id: string, input: TaskControl) => request<AgentTaskView>(`/${encodeURIComponent(id)}`, input),
  save: (id: string, input: { expectedVersion: number; title: string; body: string }) => request<AgentTaskView>(`/${encodeURIComponent(id)}/save`, input),
  saveSeminar: (id: string, input: { expectedVersion: number; seminar: AgentSeminarDraft; artifactJobId?: string }) => request<AgentTaskView>(`/${encodeURIComponent(id)}/save`, input),
};
