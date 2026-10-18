import type { LocalAgentEffort, LocalAgentProvider } from "./local-agent";
import type { SeminarDraft, SeminarWorkspace } from "@/lib/seminar/contract";
import type { SeminarExportView } from "@/lib/seminar/export-contract";

export type AgentTaskStatus = "queued" | "running" | "waiting_input" | "waiting_review" | "waiting_connection" | "completed" | "failed" | "cancelled";
export interface AgentCitation { page: number; quote: string }
export interface AgentDraft {
  title: string; body: string; lens: "research" | "repro" | "any"; sectionId: string; citations: AgentCitation[];
}
export type AgentSeminarDraft = SeminarDraft;
export interface AgentTaskInput {
  requestId: string; paperId: string; goal: string; deviceId: string; provider: LocalAgentProvider; model: string;
  effort?: LocalAgentEffort; conversationId?: string; kind?: "note" | "seminar"; completion?: "draft" | "saved_note" | "saved_presentation";
  workflow?: "guided";
}
export interface AgentTaskView {
  id: string; conversationId: string | null; version: number; revision: number; goal: string; status: AgentTaskStatus; phase: string;
  paper: { id: string; title: string }; draft: AgentDraft | null; error: string | null;
  kind?: "note" | "seminar"; seminarDraft?: AgentSeminarDraft | null;
  workspace?: SeminarWorkspace | null;
  requiresReconnect?: boolean;
  sourceChanged?: boolean;
  export?: SeminarExportView | null;
  savedPresentation?: { id: string; href: string; verified: boolean } | null;
  savedNote: { id: string; href: string; verified: boolean } | null;
  goalVerified: boolean; canCancel: boolean; canSave: boolean; canResume: boolean;
  decisionCount: number; toolCount: number; createdAt: string; updatedAt: string;
  activity: { id: string; label: string; status: string; at: string }[];
}
export interface AgentObservation {
  authority: "domain"; observedAt: string; revision: string;
  paper: { id: string; title: string; sourceReady: boolean; analysisStatus: string; analysisRequestId: string | null };
  actions: { analysis: { allowed: false; reason: string }; prepareNote: { allowed: boolean; reason: string | null } };
}
