import { z } from "zod";
import { validateDeviceToken } from "./security";
import type { LocalAgentProviderSnapshot } from "@/types/local-agent";

const Identifier = z.string().min(1).max(150);
const Credential = z.string().refine(validateDeviceToken, "올바른 연결 자격이 필요해요.");
const IsoDate = z.iso.datetime({ offset: true });
export const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
const Model = z.object({ id: z.string().min(1).max(160), name: z.string().min(1).max(160), description: z.string().max(1000).optional(), reasoningEfforts: z.array(EffortSchema).min(1).max(5).optional() }).strict();
const QuotaWindow = z.object({ label: z.string().min(1).max(80), remainingPercent: z.number().finite().min(0).max(100).nullable(), resetsAt: IsoDate.nullable() }).strict();
export const ProviderSnapshotSchema = z.object({
  provider: z.enum(["codex", "claude"]),
  status: z.enum(["ready", "login_required", "not_installed", "limited", "error"]),
  models: z.array(Model).max(200),
  quota: z.object({ short: QuotaWindow.nullable(), weekly: QuotaWindow.nullable() }).strict().nullable(),
  observedAt: IsoDate,
  quotaObservedAt: IsoDate.optional(),
  message: z.string().max(500).optional(),
}).strict();

export function sanitizeProviderSnapshot(candidate: LocalAgentProviderSnapshot): LocalAgentProviderSnapshot {
  const snapshot = { ...candidate };
  if (snapshot.status === "login_required" || snapshot.status === "not_installed" || snapshot.status === "error") {
    snapshot.models = [];
    snapshot.quota = null;
  }
  if (snapshot.quota === null) delete snapshot.quotaObservedAt;
  return snapshot;
}
export const DesktopAckSchema = z.object({ attemptId: Identifier, launchToken: Credential, deviceToken: Credential, deviceName: z.string().trim().min(1).max(80), platform: z.enum(["windows", "macos", "linux"]) }).strict();
export const DesktopPairSchema = z.object({ attemptId: Identifier, launchToken: Credential, deviceToken: Credential, code: z.string().regex(/^\d{6}$/) }).strict();
export const HeartbeatSchema = z.object({ providers: z.array(ProviderSnapshotSchema).max(2).refine((rows) => new Set(rows.map((row) => row.provider)).size === rows.length) }).strict();
export const WebHeartbeatSchema = z.object({ deviceId: Identifier }).strict();
export const JobCreateSchema = z.object({ deviceId: Identifier, paperId: Identifier, provider: z.enum(["codex", "claude"]), model: z.string().min(1).max(160), prompt: z.string().trim().min(1).max(12_000), requestId: z.uuid() }).strict();
export const ResultSchema = z.object({ jobId: Identifier, claimToken: Credential, sequence: z.number().int().min(1).max(1_000_000), status: z.enum(["running", "completed", "failed"]), response: z.string().max(200_000), error: z.string().max(1000).optional() }).strict();
export const EmptySchema = z.object({}).strict();
