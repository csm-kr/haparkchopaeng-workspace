/** Local connector REST v1. Secrets occur only in explicitly marked request/create DTOs. */
export type LocalAgentProvider = "codex" | "claude";
export type LocalAgentPlatform = "windows" | "macos" | "linux";
export type LocalAgentProviderStatus = "ready" | "login_required" | "not_installed" | "limited" | "error";
export type LocalAgentEffort = "low" | "medium" | "high" | "xhigh" | "max";
export interface LocalAgentModel { id: string; name: string; description?: string; reasoningEfforts?: LocalAgentEffort[] }
export interface LocalAgentQuotaWindow {
  label: string;
  remainingPercent: number | null;
  resetsAt: string | null;
}
export interface LocalAgentProviderSnapshot {
  provider: LocalAgentProvider;
  status: LocalAgentProviderStatus;
  models: LocalAgentModel[];
  quota: { short: LocalAgentQuotaWindow | null; weekly: LocalAgentQuotaWindow | null } | null;
  observedAt: string;
  /** Last actual quota observation; independent of fresh authentication/model metadata. */
  quotaObservedAt?: string;
  message?: string;
  capabilities?: ("agent_step_v1")[];
}
/** Authenticated self-report from the running app, independent of provider metadata. */
export interface LocalAgentBridgeMetadata {
  bridgeVersion?: string;
  bridgeArchitecture?: "arm64" | "x64";
  /** Features the running app supports; the server keeps only the ones it knows. */
  bridgeCapabilities?: string[];
}
export type LocalAgentBridgeCapability = "terminal_v1";
export interface LocalAgentDesktopHeartbeatInput extends LocalAgentBridgeMetadata {
  providers: LocalAgentProviderSnapshot[];
}
export interface LocalAgentDeviceView {
  id: string;
  name: string;
  platform: LocalAgentPlatform;
  lastSeenAt: string | null;
  online: boolean;
  leaseExpiresAt: string | null;
  /** Unknown for old apps, an expired grant or a stale desktop heartbeat. */
  bridgeVersion?: string | null;
  bridgeArchitecture?: "arm64" | "x64" | null;
  bridgeCapabilities?: LocalAgentBridgeCapability[];
  providers: LocalAgentProviderSnapshot[];
}
export type LocalAgentAttemptStatus = "awaiting_app" | "awaiting_code" | "connected" | "cancelled" | "expired";
export interface LocalAgentAttemptView {
  id: string;
  version: number;
  status: LocalAgentAttemptStatus;
  expiresAt: string;
  /** Web-authenticated response only. Never put in a URI or desktop response. */
  code: string | null;
  device: LocalAgentDeviceView | null;
}
export interface LocalAgentAttemptCreated extends LocalAgentAttemptView {
  /** One-time launch credential; not a web-session or CLI credential. */
  launchToken: string;
  deepLink: string;
}
export interface LocalAgentStatus {
  devices: LocalAgentDeviceView[];
  /** Only an explicitly requested, session-authorized device; never another online PC by default. */
  device: LocalAgentDeviceView | null;
  leaseDurationSeconds: number;
  heartbeatIntervalSeconds: number;
}
export interface LocalAgentDesktopAckInput {
  attemptId: string;
  launchToken: string;
  /** 32 random bytes encoded as base64url, created and encrypted locally. */
  deviceToken: string;
  deviceName: string;
  platform: LocalAgentPlatform;
}
export interface LocalAgentDesktopAttempt {
  attemptId: string;
  version: number;
  status: "awaiting_code" | "connected";
  expiresAt: string;
  siteName: string;
  teamName: string;
  memberName: string;
  deviceId: string | null;
  leaseExpiresAt: string | null;
}
export interface LocalAgentDesktopPairInput {
  attemptId: string;
  launchToken: string;
  deviceToken: string;
  code: string;
}
export type LocalAgentJobStatus = "preparing" | "queued" | "running" | "completed" | "failed" | "cancelled";
export interface LocalAgentJobView {
  id: string;
  version: number;
  paperId: string;
  provider: LocalAgentProvider;
  model: string;
  prompt: string;
  status: LocalAgentJobStatus;
  response: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface LocalAgentJobCreateInput {
  deviceId: string;
  paperId: string;
  provider: LocalAgentProvider;
  model: string;
  prompt: string;
  requestId: string;
}
export interface LocalAgentClaim {
  job: LocalAgentJobView;
  /** Server-scoped paper/analysis text. No arbitrary file paths, shell commands or URLs. */
  context: string;
  claimToken: string;
  leaseExpiresAt: string;
}
export interface LocalAgentDesktopHeartbeat {
  leaseExpiresAt: string;
  cancelJobIds: string[];
  heartbeatIntervalSeconds: number;
  /** One-time web requests to open a user-managed CLI terminal. Never a command. */
  terminalRequests?: LocalAgentTerminalDelivery[];
}
export interface LocalAgentTerminalDelivery { id: string; provider: LocalAgentProvider }
export interface LocalAgentTerminalRequest { requestId: string; expiresAt: string }
/** Status-only view of this web session's work; never includes prompts, answers or context. */
export interface LocalAgentActiveJobView {
  id: string;
  kind: "chat" | "paper_analysis" | "agent_task" | "question";
  provider: LocalAgentProvider;
  model: string;
  status: "preparing" | "queued" | "running";
  createdAt: string;
  href: string | null;
  canCancel: boolean;
}
export interface LocalAgentJobResultInput {
  jobId: string;
  claimToken: string;
  sequence: number;
  status: "running" | "completed" | "failed";
  /** Full accumulated answer, bounded by the API; sequence makes retries idempotent. */
  response: string;
  error?: string;
}
