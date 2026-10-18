import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    createJob: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn(),
  };
}
function chatApi(): ResearchChatApi {
  return { papers: vi.fn().mockResolvedValue(papers), prepareSources: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn(), send: vi.fn(), cancel: vi.fn() };
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
  const picker = screen.getByRole("button", { name: "모델을 선택하세요" });
  await waitFor(() => expect(picker).toBeEnabled());
  fireEvent.click(picker);
  fireEvent.click(screen.getByRole("option", { name: /감지된 연구 모델/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /팀 논문 선택/ })); });
  fireEvent.click(screen.getByRole("checkbox", { name: /첫 번째 논문/ }));
  fireEvent.click(screen.getByRole("button", { name: "논문 선택 완료" }));
  fireEvent.change(screen.getByRole("textbox", { name: "연구 질문" }), { target: { value: turn.prompt } });
}
beforeEach(() => { window.sessionStorage.clear(); window.history.replaceState(null, "", "/ai-chat"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("AI 연구 채팅", () => {
  it("연결되어도 모델을 직접 고르고, 시작 문장은 초안만 채운다", async () => {
    const api = chatApi();
    render(<View api={api} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "논문 요약" }));
    expect(screen.getByRole("textbox", { name: "연구 질문" })).toHaveValue("선택한 논문별 문제·핵심 기여·방법·한계를 원문 근거와 함께 정리해 주세요.");
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.send).not.toHaveBeenCalled();
    expect(screen.getByText("이 팀에서 나만 보는 대화예요.")).toBeInTheDocument();
  });

  it("준비된 팀 논문 1~3편만 고르며 비교에는 두 편이 필요하다", async () => {
    render(<View api={chatApi()} />);
    const picker = screen.getByRole("button", { name: "모델을 선택하세요" });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: /감지된 연구 모델/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /팀 논문 선택/ })); });
    fireEvent.click(screen.getByRole("checkbox", { name: /첫 번째 논문/ }));
    fireEvent.click(screen.getByRole("button", { name: "논문 선택 완료" }));
    fireEvent.click(screen.getByRole("button", { name: "논문 비교" }));
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    expect(screen.getByText("비교할 논문을 한 편 더 선택해 주세요.")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /팀 논문 선택/ })); });
    fireEvent.click(screen.getByRole("checkbox", { name: /두 번째 논문/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /본문 준비 논문/ }));
    expect(screen.getByRole("checkbox", { name: /네 번째 논문/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "논문 선택 완료" }));
    expect(screen.getByText("선택한 논문에 본문 준비가 필요해요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "본문 준비 논문 선택 해제" }));
    expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
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
    expect(api.create).toHaveBeenCalledWith({ requestId: expect.any(String), paperIds: ["p1"], title: turn.prompt });
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
    expect(await screen.findByText(/내 PC의 AI를 연결하면/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "새 대화" })[0]);
    expect(screen.queryByText("보존한 답변")).toBeNull();
    expect(screen.getByRole("button", { name: "논문 요약" })).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeEnabled());
  });

  it("대화를 떠난 뒤 도착한 이전 조회 응답은 새 대화를 덮어쓰지 않는다", async () => {
    const api = chatApi();
    let oldReply!: (value: ResearchConversationDetail) => void;
    vi.mocked(api.get).mockImplementation(() => new Promise((resolve) => { oldReply = resolve; }));
    render(<View api={api} initialDetail={detail([{ ...turn, status: "completed", response: "저장된 결과" }])} />);
    fireEvent.click(screen.getByRole("button", { name: /첫 연구 질문/ }));
    expect(screen.getByText("대화를 불러오고 있어요…")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "새 대화" })[0]);
    await act(async () => { oldReply(detail([{ ...turn, status: "completed", response: "늦게 도착한 결과" }])); });
    expect(screen.queryByText("늦게 도착한 결과")).toBeNull();
    expect(screen.getByRole("button", { name: "논문 요약" })).toBeInTheDocument();
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

  it("모델 없이 선택한 미준비 논문의 본문만 요청하고 실패 재시도·준비 확인 뒤 질문한다", async () => {
    const api = chatApi();
    vi.mocked(api.prepareSources).mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);
    render(<View api={api} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /팀 논문 선택/ })); });
    fireEvent.click(screen.getByRole("checkbox", { name: /첫 번째 논문/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /본문 준비 논문/ }));
    fireEvent.click(screen.getByRole("button", { name: "논문 선택 완료" }));
    fireEvent.change(screen.getByRole("textbox", { name: "연구 질문" }), { target: { value: "원문으로 요약해 주세요." } });
    fireEvent.click(screen.getByRole("button", { name: "본문 준비" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("본문 준비를 요청하지 못했어요");
    fireEvent.click(screen.getByRole("button", { name: "본문 준비" }));
    expect(await screen.findByText("본문을 준비하고 있어요. 잠시 후 상태를 다시 확인해 주세요.")).toBeInTheDocument();
    expect(api.prepareSources).toHaveBeenNthCalledWith(1, ["p3"]);
    expect(api.prepareSources).toHaveBeenNthCalledWith(2, ["p3"]);
    expect(api.create).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    vi.mocked(api.papers).mockResolvedValue(papers.map((paper) => ({ ...paper, sourceReady: true })));
    fireEvent.click(screen.getByRole("button", { name: "본문 다시 확인" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "본문 준비" })).toBeNull());
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "모델을 선택하세요" }));
    fireEvent.click(screen.getByRole("option", { name: /감지된 연구 모델/ }));
    expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
  });

  it("이미 요청한 본문도 준비 실패 사유를 우선 표시하고 재시도 승인 후 오류를 지운다", async () => {
    const api = chatApi();
    const sourceError = "PDF는 1~30쪽까지 분석할 수 있어요.";
    render(<View api={api} initialPaperId="p3" />);
    fireEvent.click(screen.getByRole("button", { name: "본문 준비" }));
    expect(await screen.findByText("본문을 준비하고 있어요. 잠시 후 상태를 다시 확인해 주세요.")).toBeInTheDocument();
    vi.mocked(api.papers).mockResolvedValue(papers.map(paper => paper.id === "p3" ? { ...paper, sourceError } : paper));
    fireEvent.click(screen.getByRole("button", { name: "본문 다시 확인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(sourceError);
    expect(screen.queryByText("본문을 준비하고 있어요. 잠시 후 상태를 다시 확인해 주세요.")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /팀 논문 선택/ })); });
    expect(screen.getByRole("checkbox", { name: /본문 준비 논문.*본문 준비 실패/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "논문 선택 완료" }));
    fireEvent.click(screen.getByRole("button", { name: "본문 준비 다시 시도" }));
    expect(await screen.findByText("본문을 준비하고 있어요. 잠시 후 상태를 다시 확인해 주세요.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.prepareSources).toHaveBeenNthCalledWith(2, ["p3"]);
    expect(api.create).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
  });

  it("저장한 대화의 본문 오류도 재시도하며 기존 질문과 답변을 유지한다", async () => {
    const api = chatApi();
    const completed = { ...turn, status: "completed" as const, response: "기존 답변" };
    const initialDetail = { ...detail([completed]), papers: [{ ...papers[2], sourceError: "읽을 수 있는 본문 텍스트가 없어요. 스캔 PDF는 텍스트를 포함한 PDF로 바꿔주세요." }] };
    render(<View api={api} initialDetail={initialDetail} />);
    expect(screen.getByRole("alert")).toHaveTextContent("스캔 PDF");
    fireEvent.click(screen.getByRole("button", { name: "본문 준비 다시 시도" }));
    expect(await screen.findByText("본문을 준비하고 있어요. 잠시 후 상태를 다시 확인해 주세요.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("기존 답변")).toBeInTheDocument();
    expect(api.prepareSources).toHaveBeenCalledWith(["p3"]);
    expect(api.send).not.toHaveBeenCalled();
  });
});
