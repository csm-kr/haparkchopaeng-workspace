import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchChat } from "../research-chat";
import type { ResearchChatApi } from "../client";

const agent = vi.hoisted(() => ({ phase: "connected", selectedModel: null, effort: "high", device: { id: "pc", name: "내 PC", providers: [{ provider: "codex", status: "ready", models: [{ id: "actual", name: "실제 모델", reasoningEfforts: ["low", "medium", "high"] }] }] } }));
vi.mock("@/components/local-agent/provider", () => ({ useLocalAgent: () => agent }));
const papers = [{ id: "p1", title: "첫 번째 논문", sourceReady: true }, { id: "p2", title: "두 번째 논문", sourceReady: false }];
const presentations = [{ id: "s1", title: "토요일 세미나", date: "2026-10-17T00:00:00Z" }];
const conversation = { id: "chat", title: "자유 대화", paperIds: [], createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z" };
function api(): ResearchChatApi {
  return { papers: vi.fn().mockResolvedValue(papers), presentations: vi.fn().mockResolvedValue(presentations), list: vi.fn().mockResolvedValue([]), get: vi.fn(), prepareSources: vi.fn(),
    create: vi.fn().mockResolvedValue(conversation), send: vi.fn().mockResolvedValue({ id: "turn", version: 1, conversationId: "chat", conversationTurn: 1, status: "queued", prompt: "안녕", response: "", createdAt: conversation.createdAt, updatedAt: conversation.updatedAt }), cancel: vi.fn(), remove: vi.fn() };
}
beforeEach(() => { window.history.replaceState(null, "", "/ai-chat"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("자유 채팅 입력창", () => {
  it("자료 추가 후 사용자가 선택한 입력 범위를 늦은 프레임이 덮지 않는다", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    render(<ResearchChat teamId="team" initialPapers={papers} initialConversations={[]} api={api()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "자료 추가" })); });
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "연구 질문" });
    expect(input.value).toBe("@");
    input.focus(); input.select();
    act(() => { for (const callback of frames.splice(0)) callback(performance.now()); });
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
  });
  it("자료 선택 후 사용자가 선택한 남은 문장을 늦은 프레임이 덮지 않는다", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    render(<ResearchChat teamId="team" initialPapers={papers} initialConversations={[]} api={api()} />);
    const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "연구 질문" });
    fireEvent.change(input, { target: { value: "앞 문장 @첫 번째" } });
    fireEvent.click(screen.getByRole("option", { name: /첫 번째 논문/ }));
    expect(input.value).toBe("앞 문장 ");
    input.focus(); input.select();
    act(() => { for (const callback of frames.splice(0)) callback(performance.now()); });
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  });
  it("자료 없는 팀도 카테고리·모델 선택 단계 없이 바로 질문한다", async () => {
    const client = api();
    render(<ResearchChat teamId="team" initialPapers={[]} initialConversations={[]} api={client} />);
    expect(screen.queryByRole("button", { name: "논문 요약" })).toBeNull();
    expect(screen.queryByText("사용할 모델")).toBeNull();
    expect(screen.queryByText(/CLI·AI 공급자/)).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "연구 질문" }), { target: { value: "안녕, 함께 생각해보자." } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(client.send).toHaveBeenCalledWith("chat", expect.objectContaining({ provider: "codex", model: "actual", effort: "high", paperIds: [], presentationIds: [], prompt: "안녕, 함께 생각해보자." })));
  });
  it("@로 논문과 세미나를 검색하고 Enter는 자료를 선택하며 한국어 조합 중에는 전송하지 않는다", async () => {
    const client = api();
    render(<ResearchChat teamId="team" initialPapers={papers} initialPresentations={presentations} initialConversations={[]} api={client} />);
    const input = screen.getByRole("textbox", { name: "연구 질문" });
    fireEvent.change(input, { target: { value: "@토요일" } });
    expect(screen.getByRole("option", { name: /토요일 세미나/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(client.send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(client.send).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "토요일 세미나 선택 해제" })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "@첫 번째" } });
    fireEvent.click(screen.getByRole("option", { name: /첫 번째 논문/ }));
    fireEvent.change(input, { target: { value: "두 자료의 실험 가정은 어떻게 달라?" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(client.send).toHaveBeenCalledWith("chat", expect.objectContaining({ paperIds: ["p1"], presentationIds: ["s1"] })));
  });
  it("기존 대화에서도 자료를 바꾸고 미준비 논문을 바로 전송한다", async () => {
    const client = api();
    render(<ResearchChat teamId="team" initialPapers={papers} initialConversations={[conversation]} initialDetail={{ conversation: { ...conversation, paperIds: ["p1"] }, papers: [papers[0]], turns: [], hasEarlierTurns: false }} api={client} />);
    fireEvent.click(screen.getByRole("button", { name: "첫 번째 논문 선택 해제" }));
    const input = screen.getByRole("textbox", { name: "연구 질문" });
    fireEvent.change(input, { target: { value: "@두 번째" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "이 논문을 같이 읽어보자" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(client.send).toHaveBeenCalledWith("chat", expect.objectContaining({ paperIds: ["p2"] })));
    expect(client.prepareSources).not.toHaveBeenCalled();
  });
  it("@ 검색 결과가 없어도 Escape로 닫고 일반 질문을 계속한다", async () => {
    const client = api();
    render(<ResearchChat teamId="team" initialPapers={[]} initialConversations={[]} api={client} />);
    const input = screen.getByRole("textbox", { name: "연구 질문" });
    fireEvent.change(input, { target: { value: "@없는자료" } });
    expect(screen.getByText("맞는 자료가 없어요.")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.change(input, { target: { value: "일반 질문으로 이어가자" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "보내기" })); });
    expect(client.send).toHaveBeenCalledTimes(1);
  });
  it("최근 자료 목록에 없는 오래된 대화의 자료도 다음 메시지에 유지한다", async () => {
    const client = api();
    vi.mocked(client.send).mockResolvedValue({ id: "turn", version: 1, conversationId: "chat", conversationTurn: 1, status: "completed", canCancel: false, contextTruncated: false, paperId: "p1", provider: "codex", model: "actual", error: null, prompt: "계속 읽자", response: "답변", createdAt: conversation.createdAt, updatedAt: conversation.updatedAt });
    render(<ResearchChat teamId="team" initialPapers={[]} initialConversations={[conversation]} initialDetail={{ conversation: { ...conversation, paperIds: ["p1"] }, papers: [papers[0]], turns: [], hasEarlierTurns: false }} api={client} />);
    fireEvent.change(screen.getByRole("textbox", { name: "연구 질문" }), { target: { value: "계속 읽자" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "첫 번째 논문 선택 해제" })).toBeInTheDocument();
  });
  it("자료 없는 후속 질문은 같은 대화에 이어지고 앞선 답변을 유지한다", async () => {
    const client = api();
    const first = { id: "first-turn", version: 1, conversationId: "chat", conversationTurn: 1, status: "completed" as const,
      canCancel: false, contextTruncated: false, paperId: "", provider: "codex" as const, model: "actual", error: null,
      prompt: "연구 계획을 같이 세우자", response: "첫 번째 연구 계획", createdAt: conversation.createdAt, updatedAt: conversation.updatedAt };
    vi.mocked(client.send).mockResolvedValueOnce(first).mockResolvedValueOnce({ ...first,
      id: "second-turn", conversationTurn: 2, prompt: "그 계획의 첫 실험을 구체화해줘", response: "앞선 계획을 이은 실험" });
    render(<ResearchChat teamId="team" initialPapers={[]} initialConversations={[]} api={client} />);
    const input = screen.getByRole("textbox", { name: "연구 질문" });
    fireEvent.change(input, { target: { value: first.prompt } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText(first.response)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "그 계획의 첫 실험을 구체화해줘" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText("앞선 계획을 이은 실험")).toBeInTheDocument();
    expect(screen.getByText(first.response)).toBeInTheDocument();
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(client.send).mock.calls;
    expect(calls.map(([id]) => id)).toEqual(["chat", "chat"]);
    expect(calls[1][1]).toMatchObject({ paperIds: [], presentationIds: [], prompt: "그 계획의 첫 실험을 구체화해줘" });
    expect(calls[1][1].requestId).not.toBe(calls[0][1].requestId);
    expect(calls[1][1]).not.toHaveProperty("context");
  });
});
