import type { ResearchChatTurn, ResearchChatTurnInput, ResearchConversationCreateInput, ResearchConversationDetail, ResearchConversationView, ResearchPaperOption, ResearchPresentationOption } from "@/types/research-chat";

export class ResearchChatApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export interface ResearchChatApi {
  papers(): Promise<ResearchPaperOption[]>;
  presentations(): Promise<ResearchPresentationOption[]>;
  prepareSources(paperIds: string[]): Promise<void>;
  list(): Promise<ResearchConversationView[]>;
  get(id: string): Promise<ResearchConversationDetail>;
  create(input: ResearchConversationCreateInput): Promise<ResearchConversationView>;
  send(id: string, input: ResearchChatTurnInput): Promise<ResearchChatTurn>;
  cancel(id: string, jobId: string): Promise<ResearchChatTurn>;
  remove(id: string): Promise<void>;
}

async function request<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const res = await fetch(`/api/research-chat${path}`, {
    method, credentials: "same-origin", cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !("data" in json)) throw new ResearchChatApiError(res.status, typeof json?.error?.code === "string" ? json.error.code : "UNAVAILABLE");
  return json.data as T;
}

export const researchChatApi: ResearchChatApi = {
  papers: () => request("/papers"), list: () => request("/conversations"),
  presentations: () => request("/presentations"),
  prepareSources: async (paperIds) => { await request("/sources", { paperIds }); },
  get: (id) => request(`/conversations/${encodeURIComponent(id)}`),
  create: (input) => request("/conversations", input),
  send: (id, input) => request(`/conversations/${encodeURIComponent(id)}/turns`, input),
  cancel: (id, jobId) => request(`/conversations/${encodeURIComponent(id)}/turns/${encodeURIComponent(jobId)}/cancel`, {}),
  remove: async (id) => { await request(`/conversations/${encodeURIComponent(id)}`, undefined, "DELETE"); },
};

export function chatError(error: unknown): string {
  if (error instanceof ResearchChatApiError) {
    if (error.status === 401) return "웹 로그인이 끝났어요. 다시 로그인한 뒤 AI를 연결해 주세요.";
    if (error.status === 403) return "이 팀의 대화 권한을 다시 확인해 주세요.";
    if (error.status === 404) return "현재 팀에서 열 수 없는 대화예요.";
    if (error.code === "SOURCE_NOT_READY") return "논문 본문을 준비하고 있어요. 잠시 뒤 다시 확인해 주세요.";
    if (error.code === "CONVERSATION_TASK_ACTIVE") return "진행 중인 노트·세미나 작업을 멈춘 뒤 대화를 삭제해 주세요.";
    if (error.code === "CONVERSATION_BUSY") return "이 대화의 앞선 답변이 진행 중이에요. 상태를 다시 확인해 주세요.";
    if (error.code === "EFFORT_UNAVAILABLE") return "연결 설정에서 이 모델이 지원하는 effort를 선택해주세요.";
    if (error.status === 409) return "AI 연결과 선택한 모델을 다시 확인해 주세요.";
    if (error.status === 429) return "요청이 잠시 많아요. 조금 뒤 다시 시도해 주세요.";
    if (error.status === 503) return "AI 채팅을 준비 중이에요. 잠시 뒤 다시 시도해 주세요.";
  }
  return "통신이 잠시 끊겼어요. 작성한 질문을 보관했으니 다시 시도해 주세요.";
}
