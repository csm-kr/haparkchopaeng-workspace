import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAgentDeviceView, LocalAgentStatus } from "@/types/local-agent";
import type { ResearchChatTurn, ResearchConversationDetail, ResearchConversationView, ResearchPaperOption } from "@/types/research-chat";
import { LocalAgentApiError, type LocalAgentApi } from "@/components/local-agent/client";
import { LocalAgentProvider } from "@/components/local-agent/provider";
import { ResearchChat, type ResearchChatProps } from "../research-chat";
import { ResearchChatApiError, type ResearchChatApi } from "../client";

const device: LocalAgentDeviceView = {
  id: "device-chat", name: "내 연구용 PC", platform: "windows", online: true,
  lastSeenAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 45000).toISOString(),
  providers: [{ provider: "codex", status: "ready", models: [{ id: "detected", name: "감지된 연구 모델" }], quota: null, observedAt: new Date().toISOString() }],
};
const papers: ResearchPaperOption[] = [
  { id: "p1", title: "첫 번째 논문", sourceReady: true },
  { id: "p2", title: "두 번째 논문", sourceReady: true },
  { id: "p3", title: "본문 준비 논문", sourceReady: false },
  { id: "p4", title: "네 번째 논문", sourceReady: true },
];
function connectorApi(connected = true): LocalAgentApi {
  const status: LocalAgentStatus = { device: connected ? device : null, devices: connected ? [device] : [], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 };
  return {
    status: vi.fn().mockResolvedValue(status), heartbeat: vi.fn().mockResolvedValue({ leaseExpiresAt: device.leaseExpiresAt }),
    createAttempt: vi.fn(), getAttempt: vi.fn(), cancelAttempt: vi.fn(), disconnect: vi.fn(), downloads: vi.fn(),
    createJob: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn(), openTerminal: vi.fn(), activeJobs: vi.fn().mockResolvedValue([]),
  };
}
function chatApi(): ResearchChatApi {
  return { papers: vi.fn().mockResolvedValue(papers), presentations: vi.fn().mockResolvedValue([]), prepareSources: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn(), send: vi.fn(), cancel: vi.fn(), remove: vi.fn().mockResolvedValue(undefined) };
}
const conversation: ResearchConversationView = { id: "conversation-a", title: "첫 연구 질문", paperIds: ["p1"], createdAt: "2026-10-17T10:00:00.000Z", updatedAt: "2026-10-17T10:00:00.000Z" };
const turn: ResearchChatTurn = { id: "turn-a", version: 1, conversationId: conversation.id, conversationTurn: 1, canCancel: true, contextTruncated: false, paperId: "p1", provider: "codex", model: "detected", prompt: "핵심 기여가 뭔가요?", status: "queued", response: "", error: null, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt };
function detail(turns: ResearchChatTurn[] = []): ResearchConversationDetail { return { conversation, papers: [papers[0]], turns, hasEarlierTurns: false }; }
function View({ api, connected = true, connectionApi, initialDetail, ...rest }: { api: ResearchChatApi; connected?: boolean; connectionApi?: LocalAgentApi; initialDetail?: ResearchConversationDetail } & Partial<ResearchChatProps>) {
  return <LocalAgentProvider teamId="team-a" api={connectionApi ?? connectorApi(connected)}>
    <ResearchChat teamId="team-a" initialPapers={papers} initialConversations={initialDetail ? [initialDetail.conversation] : []} initialDetail={initialDetail} api={api} {...rest} />
  </LocalAgentProvider>;
}
async function prepareQuestion() {
  const input = screen.getByRole("textbox", { name: "연구 질문" });
  fireEvent.change(input, { target: { value: "@첫 번째" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: turn.prompt } });
  await waitFor(() => expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled());
}
beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); window.history.replaceState(null, "", "/ai-chat"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("AI 연구 채팅", () => {
  it("설정이나 카테고리를 고르는 단계 없이 질문 초안을 작성한다", async () => {
    const api = chatApi();
    render(<View api={api} />);
    expect(screen.queryByText("사용할 모델")).toBeNull();
    expect(screen.queryByRole("button", { name: "논문 요약" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "연구 질문" }), { target: { value: "자유롭게 시작해보자" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled());
    expect(api.create).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
  });

  it("세 편을 넘겨도 @로 자료를 추가하고 준비 전 논문도 바로 질문한다", async () => {
    render(<View api={chatApi()} />);
    const input = screen.getByRole("textbox", { name: "연구 질문" });
    for (const paper of papers) {
      fireEvent.change(input, { target: { value: `@${paper.title}` } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    expect(screen.getByRole("button", { name: "네 번째 논문 선택 해제" })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "어떤 공통점이 있을까?" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "본문 준비" })).toBeNull();
  });

  it("첫 대화를 한 번 저장하고 부분 답변을 같은 턴에 누적하며 중지한다", async () => {
    const api = chatApi();
    let accept!: (value: ResearchChatTurn) => void;
    vi.mocked(api.create).mockResolvedValue(conversation);
    vi.mocked(api.send).mockImplementation(() => new Promise((resolve) => { accept = resolve; }));
    vi.mocked(api.get).mockResolvedValue(detail([{ ...turn, status: "running", version: 2, response: "부분 답변" }]));
    vi.mocked(api.cancel).mockResolvedValue({ ...turn, status: "cancelled", version: 3, response: "부분 답변", error: null });
    render(<View api={api} />);
    await prepareQuestion();
    const send = screen.getByRole("button", { name: "보내기" });
    fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledWith({ requestId: expect.any(String), paperIds: ["p1"], presentationIds: [], title: turn.prompt });
    await act(async () => { accept(turn); });
    expect(screen.getByRole("textbox", { name: "연구 질문" })).toHaveValue("");
    expect(await screen.findByText("부분 답변", {}, { timeout: 2500 })).toBeInTheDocument();
    expect(screen.getAllByText(turn.prompt)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "답변 중지" }));
    expect(await screen.findByText("답변을 중지했어요.")).toBeInTheDocument();
    expect(screen.getByText("부분 답변")).toBeInTheDocument();
    expect(api.cancel).toHaveBeenCalledWith(conversation.id, turn.id);
    expect(window.location.pathname).toBe(`/ai-chat/${conversation.id}`);
  });

  it("접수 응답이 유실돼도 초안과 요청 번호를 유지하여 중복 대화를 만들지 않는다", async () => {
    const api = chatApi();
    vi.mocked(api.create).mockResolvedValue(conversation);
    vi.mocked(api.send).mockRejectedValueOnce(new Error("network")).mockResolvedValue(turn);
    render(<View api={api} />);
    await prepareQuestion();
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("통신이 잠시 끊겼어요");
    expect(screen.getByRole("textbox", { name: "연구 질문" })).toHaveValue(turn.prompt);
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2));
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.send).mock.calls[0]).toEqual(vi.mocked(api.send).mock.calls[1]);
  });

  it("연결 없이 저장 이력을 읽고 새 대화를 시작하며 실패 원인을 답변 안에 보여 준다", async () => {
    const api = chatApi();
    render(<View api={api} connected={false} initialDetail={detail([{ ...turn, status: "failed", canCancel: false, error: "구독 사용 한도에 도달했어요.", response: "보존한 답변" }])} />);
    expect(screen.getByText("보존한 답변")).toBeInTheDocument();
    expect(screen.getByText("구독 사용 한도에 도달했어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "새 대화" })[0]);
    expect(screen.queryByText("보존한 답변")).toBeNull();
    expect(screen.getByRole("heading", { name: "무엇을 함께 생각해 볼까요?" })).toBeInTheDocument();
    expect(api.send).not.toHaveBeenCalled();
  });

  it("세션 만료는 네트워크 오류와 구분하고 이전 답변 노출을 멈춘다", async () => {
    const api = chatApi();
    vi.mocked(api.get).mockRejectedValue(new ResearchChatApiError(401, "UNAUTHORIZED"));
    render(<View api={api} initialDetail={detail([{ ...turn, status: "running", response: "이전 비공개 답변" }])} />);
    expect(await screen.findByRole("link", { name: "다시 로그인" }, { timeout: 2500 })).toHaveAttribute("href", "/");
    expect(screen.queryByText("이전 비공개 답변")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("웹 로그인이 끝났어요");
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
  });

  it("저장 답변의 표와 코드는 읽기 좋게 표시하고 HTML은 실행하지 않는다", async () => {
    render(<View api={chatApi()} initialDetail={detail([{ ...turn, status: "completed", response: "## 요약\n\n| 방법 | 한계 |\n| --- | --- |\n| 기준 모델 | 데이터 부족 |\n\n```python\nprint('research')\n```\n\n<img src=x onerror=alert(1)>" }])} />);
    expect(screen.getByRole("columnheader", { name: "방법" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "데이터 부족" })).toBeInTheDocument();
    expect(screen.getByText("print('research')").tagName).toBe("CODE");
    expect(screen.getByRole("heading", { name: "요약" })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "연구 질문" })).toBeEnabled());
  });

  it("대화를 떠난 뒤 도착한 이전 조회 응답은 새 대화를 덮어쓰지 않는다", async () => {
    const api = chatApi();
    let oldReply!: (value: ResearchConversationDetail) => void;
    vi.mocked(api.get).mockImplementation(() => new Promise((resolve) => { oldReply = resolve; }));
    render(<View api={api} initialDetail={detail([{ ...turn, status: "completed", response: "저장된 결과" }])} />);
    fireEvent.click(screen.getByRole("button", { name: /^첫 연구 질문 \d/ }));
    expect(screen.getByText("대화를 불러오고 있어요…")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "새 대화" })[0]);
    await act(async () => { oldReply(detail([{ ...turn, status: "completed", response: "늦게 도착한 결과" }])); });
    expect(screen.queryByText("늦게 도착한 결과")).toBeNull();
    expect(screen.getByRole("heading", { name: "무엇을 함께 생각해 볼까요?" })).toBeInTheDocument();
  });

  it("한국어 조합 Enter는 전송하지 않고 완성한 Enter만 전송한다", async () => {
    const api = chatApi();
    vi.mocked(api.create).mockResolvedValue(conversation); vi.mocked(api.send).mockResolvedValue(turn);
    render(<View api={api} />);
    await prepareQuestion();
    const input = screen.getByRole("textbox", { name: "연구 질문" });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
  });

  it("저장 대화의 첫 조회가 실패해도 같은 주소를 다시 조회하여 복구한다", async () => {
    const api = chatApi();
    vi.mocked(api.get).mockResolvedValue(detail([{ ...turn, status: "completed", response: "다시 불러온 저장 답변" }]));
    render(<View api={api} initialError="대화를 불러오지 못했어요." initialConversationId={conversation.id} />);
    fireEvent.click(screen.getByRole("button", { name: "상태 다시 확인" }));
    expect(await screen.findByText("다시 불러온 저장 답변")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(conversation.id);
    expect(api.send).not.toHaveBeenCalled();
  });

  it.each([
    { name: "웹 세션 만료", status: 401, target: "/", link: "다시 로그인" },
    { name: "팀 권한 상실", status: 403, target: "/teams", link: "팀 확인" },
    { name: "실행 권한만 만료", status: 200, target: null, link: null },
  ])("완료 이력에서도 $name 전이를 대화 API에서 한 번 재검증한다", async ({ status, target, link }) => {
    const api = chatApi(), connectionApi = connectorApi();
    const saved = detail([{ ...turn, status: "completed", canCancel: false, response: "완료한 비공개 답변" }]);
    if (status === 200) vi.mocked(api.get).mockResolvedValue(saved);
    else vi.mocked(api.get).mockRejectedValue(new ResearchChatApiError(status, status === 401 ? "UNAUTHORIZED" : "FORBIDDEN"));
    const view = render(<View api={api} connectionApi={connectionApi} initialDetail={saved} />);
    await waitFor(() => expect(connectionApi.status).toHaveBeenCalledTimes(2));
    expect(api.get).not.toHaveBeenCalled();
    vi.mocked(connectionApi.heartbeat).mockRejectedValue(new LocalAgentApiError(403, "FORBIDDEN"));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(api.get).toHaveBeenCalledWith(conversation.id);
    if (target && link) {
      expect(await screen.findByRole("link", { name: link })).toHaveAttribute("href", target);
      expect(screen.queryByText("완료한 비공개 답변")).toBeNull();
    } else {
      expect(screen.getByText("완료한 비공개 답변")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "다시 로그인" })).toBeNull();
    }
    view.rerender(<View api={api} connectionApi={connectionApi} initialDetail={saved} />);
    await act(async () => { await Promise.resolve(); });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.send).not.toHaveBeenCalled();
  });

  it("미준비 자료도 전송하면 준비 상태를 표시하고 중지할 수 있다", async () => {
    const api = chatApi();
    const pending = { ...turn, status: "preparing" as const };
    vi.mocked(api.cancel).mockResolvedValue({ ...pending, status: "cancelled", canCancel: false });
    render(<View api={api} initialDetail={detail([pending])} />);
    expect(screen.getByText("첨부 자료를 읽고 있어요…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "답변 중지" }));
    expect(await screen.findByText("답변을 중지했어요.")).toBeInTheDocument();
    expect(api.prepareSources).not.toHaveBeenCalled();
  });

  it("자료 준비 실패는 답변에 표시하고 다시 쓰기로 질문을 보존한다", async () => {
    const api = chatApi();
    const failed = { ...turn, status: "failed" as const, canCancel: false, error: "스캔 PDF에서 본문을 읽지 못했어요." };
    render(<View api={api} initialDetail={detail([failed])} />);
    expect(screen.getByText("스캔 PDF에서 본문을 읽지 못했어요.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "질문 다시 쓰기" }));
    expect(screen.getByRole("textbox", { name: "연구 질문" })).toHaveValue(turn.prompt);
    await waitFor(() => expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled());
  });

  it("저장 대화의 자료를 제거해도 기존 답변을 유지하고 새 질문을 작성한다", async () => {
    const api = chatApi();
    render(<View api={api} initialDetail={detail([{ ...turn, status: "completed", canCancel: false, response: "기존 답변" }])} />);
    fireEvent.click(screen.getByRole("button", { name: "첫 번째 논문 선택 해제" }));
    fireEvent.change(screen.getByRole("textbox", { name: "연구 질문" }), { target: { value: "새로운 주제로 이야기하자" } });
    expect(screen.getByText("기존 답변")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled());
    expect(api.send).not.toHaveBeenCalled();
  });
});

describe("대화 삭제", () => {
  const other: ResearchConversationView = { id: "conversation-b", title: "두 번째 연구 질문", paperIds: [], createdAt: "2026-10-16T10:00:00.000Z", updatedAt: "2026-10-16T10:00:00.000Z" };
  function renderWithList(api: ResearchChatApi) {
    window.history.replaceState(null, "", `/ai-chat/${conversation.id}`);
    render(<View api={api} initialDetail={detail([{ ...turn, status: "completed", canCancel: false, response: "기존 답변" }])} initialConversations={[conversation, other]} />);
  }
  const list = () => screen.getByRole("navigation", { name: "내 AI 대화" });

  it("목록의 점 3개 메뉴에서 한 번 더 확인한 뒤 다른 대화를 지우고 지금 대화는 유지한다", async () => {
    const api = chatApi();
    renderWithList(api);
    fireEvent.click(screen.getByRole("button", { name: "두 번째 연구 질문 더보기" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "삭제" }));
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.getByText(/「두 번째 연구 질문」 대화를 삭제할까요\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("conversation-b"));
    await waitFor(() => expect(within(list()).queryByText("두 번째 연구 질문")).toBeNull());
    expect(screen.getByText("기존 답변")).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/ai-chat/${conversation.id}`);
  });

  it("지금 열린 대화를 지우면 새 대화 화면으로 돌아간다", async () => {
    const api = chatApi();
    renderWithList(api);
    fireEvent.click(screen.getByRole("button", { name: "현재 대화 더보기" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(window.location.pathname).toBe("/ai-chat"));
    expect(screen.queryByText("기존 답변")).toBeNull();
    expect(within(list()).queryByText("첫 연구 질문")).toBeNull();
    expect(within(list()).getByText("두 번째 연구 질문")).toBeInTheDocument();
  });

  it("확인 단계에서 취소하거나 Escape를 누르면 지우지 않고 메뉴 버튼으로 포커스를 돌린다", async () => {
    const api = chatApi();
    renderWithList(api);
    const trigger = screen.getByRole("button", { name: "두 번째 연구 질문 더보기" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("menuitem", { name: "삭제" })).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(await screen.findByRole("menuitem", { name: "삭제" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "삭제" })).toBeNull());
    expect(trigger).toHaveFocus();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("진행 중인 노트·세미나 작업 때문에 지우지 못하면 이유를 보여 주고 목록을 유지한다", async () => {
    const api = chatApi();
    vi.mocked(api.remove).mockRejectedValue(new ResearchChatApiError(409, "CONVERSATION_TASK_ACTIVE"));
    renderWithList(api);
    fireEvent.click(screen.getByRole("button", { name: "두 번째 연구 질문 더보기" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(await screen.findByText("진행 중인 노트·세미나 작업을 멈춘 뒤 대화를 삭제해 주세요.")).toBeInTheDocument();
    expect(within(list()).getByText("두 번째 연구 질문")).toBeInTheDocument();
  });

  it("다른 곳에서 이미 지운 대화는 목록에서도 정리한다", async () => {
    const api = chatApi();
    vi.mocked(api.remove).mockRejectedValue(new ResearchChatApiError(404, "NOT_FOUND"));
    renderWithList(api);
    fireEvent.click(screen.getByRole("button", { name: "두 번째 연구 질문 더보기" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(within(list()).queryByText("두 번째 연구 질문")).toBeNull());
  });
});
