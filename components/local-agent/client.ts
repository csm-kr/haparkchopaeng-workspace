import type {
  LocalAgentAttemptCreated, LocalAgentAttemptView, LocalAgentJobCreateInput,
  LocalAgentJobView, LocalAgentPlatform, LocalAgentStatus,
} from "@/types/local-agent";

export interface ConnectorRelease {
  platform: LocalAgentPlatform;
  url: string;
  version: string;
  filename?: string;
  architecture?: string;
  unsigned?: boolean;
}

export class LocalAgentApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export interface LocalAgentApi {
  status(deviceId?: string | null): Promise<LocalAgentStatus>;
  createAttempt(): Promise<LocalAgentAttemptCreated>;
  getAttempt(id: string): Promise<LocalAgentAttemptView>;
  cancelAttempt(id: string): Promise<{ cancelled: boolean }>;
  heartbeat(deviceId: string): Promise<{ leaseExpiresAt: string }>;
  disconnect(deviceId: string): Promise<{ revoked: boolean }>;
  downloads(): Promise<{ releases: ConnectorRelease[] }>;
  createJob(input: LocalAgentJobCreateInput): Promise<LocalAgentJobView>;
  getJob(id: string): Promise<LocalAgentJobView>;
  cancelJob(id: string): Promise<LocalAgentJobView>;
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/local-agent${path}`, {
    method, credentials: "same-origin", cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json || !("data" in json)) {
    throw new LocalAgentApiError(response.status, typeof json?.error?.code === "string" ? json.error.code : "UNAVAILABLE");
  }
  return json.data as T;
}

export const localAgentApi: LocalAgentApi = {
  status: (id) => request(`/status${id ? `?deviceId=${encodeURIComponent(id)}` : ""}`),
  createAttempt: () => request("/attempts", "POST", {}),
  getAttempt: (id) => request(`/attempts/${encodeURIComponent(id)}`),
  cancelAttempt: (id) => request(`/attempts/${encodeURIComponent(id)}`, "DELETE"),
  heartbeat: (id) => request("/web-heartbeat", "POST", { deviceId: id }),
  disconnect: (id) => request(`/devices/${encodeURIComponent(id)}`, "DELETE"),
  downloads: () => request("/downloads"),
  createJob: (input) => request("/jobs", "POST", input),
  getJob: (id) => request(`/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id) => request(`/jobs/${encodeURIComponent(id)}/cancel`, "POST", {}),
};

/** URI 값은 명령이나 서버 주소로 해석하지 않는다. 브라우저가 등록된 앱에 전달한다. */
export function launchConnector(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "hapark-connect:" || parsed.hostname !== "connect") return false;
    if (typeof navigator.userActivation !== "undefined" && !navigator.userActivation.isActive) return false;
    window.location.assign(url);
    return true;
  } catch { return false; }
}

export function errorMessage(error: unknown): string {
  if (error instanceof LocalAgentApiError) {
    if (error.status === 401 || error.status === 403) return "다시 로그인해 주세요. 이 PC를 다시 확인해야 해요.";
    if (error.status === 409) return "연결 상태가 바뀌었어요. 상태를 다시 확인해 주세요.";
    if (error.status === 429) return "요청이 잠시 많아요. 조금 뒤 다시 시도해 주세요.";
    if (error.status === 503) return "AI 연결을 준비 중이에요. 잠시 뒤 다시 시도해 주세요.";
  }
  return "연결 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}
