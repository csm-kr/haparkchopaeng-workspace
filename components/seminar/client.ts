import { agentTaskApi, AgentApiError } from "@/components/agent/client";
import type { AgentTaskView } from "@/types/agent-task";
import type { SeminarAction } from "@/lib/seminar/contract";
import type { ExportRequest, SeminarExportView } from "@/lib/seminar/export-contract";

export const seminarApi = {
  create: agentTaskApi.create,
  get: agentTaskApi.get,
  control: agentTaskApi.control,
  save: agentTaskApi.saveSeminar,
  async export(id: string, input: ExportRequest): Promise<{ task: AgentTaskView; export: SeminarExportView }> {
    const response = await fetch(`/api/agent/tasks/${encodeURIComponent(id)}/exports`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const body = await response.json();
    if (!response.ok) throw new AgentApiError(response.status,body?.error?.code ?? "UNKNOWN",body?.error?.message ?? "발표 파일을 준비하지 못했어요. 다시 시도해주세요.");
    return body.data;
  },
  async turn(id: string, input: SeminarAction): Promise<AgentTaskView> {
    const response = await fetch(`/api/agent/tasks/${encodeURIComponent(id)}/seminar`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const body = await response.json();
    if (!response.ok) throw new AgentApiError(response.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? "PT 대화를 이어가지 못했어요. 다시 시도해주세요.");
    return body.data;
  },
};
