import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalAgentProvider } from "../provider";
import { ConnectionSettings } from "../connection-settings";
import { ResearchChat } from "@/components/research-chat/research-chat";
import type { LocalAgentApi } from "../client";
import type { ResearchChatApi } from "@/components/research-chat/client";
import type { LocalAgentDeviceView, LocalAgentProviderStatus } from "@/types/local-agent";
import { LocalAgentModelPicker } from "../model-picker";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); window.history.replaceState(null, "", "/ai-chat"); });
afterEach(cleanup);

function fixture() {
  const device = { id: "pc", name: "연구용 PC", platform: "windows", lastSeenAt: null, leaseExpiresAt: null, online: true, providers: [{ provider: "codex", status: "ready", models: [{ id: "first", name: "첫 모델" }, { id: "second", name: "두 번째 모델", reasoningEfforts: ["low", "high"] }], quota: null, observedAt: new Date().toISOString() }] };
  const connection = { status: vi.fn().mockResolvedValue({ device, devices: [device] }), heartbeat: vi.fn().mockResolvedValue({}), createAttempt: vi.fn(), getAttempt: vi.fn(), cancelAttempt: vi.fn(), downloads: vi.fn().mockResolvedValue({ releases: [{ platform: "windows", architecture: "x64", version: "0.1.2", url: "https://downloads.example/bridge-latest.exe", filename: "bridge-latest.exe" }] }), createJob: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn(), disconnect: vi.fn() } satisfies LocalAgentApi;
  const now = new Date().toISOString();
  const chat: ResearchChatApi = { papers: vi.fn().mockResolvedValue([]), presentations: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue([]), get: vi.fn(), prepareSources: vi.fn(), create: vi.fn().mockResolvedValue({ id: "chat", title: "내 대화", paperIds: [], createdAt: now, updatedAt: now }), send: vi.fn().mockResolvedValue({ id: "turn", conversationId: "chat", conversationTurn: 1, status: "queued", version: 1, createdAt: now, updatedAt: now }), cancel: vi.fn() };
  return { connection, chat };
}

it("연결 설정을 열었을 때만 모델과 effort가 보이고 선택값이 다음 질문에 전달된다", async () => {
  const { connection, chat } = fixture();
  render(<LocalAgentProvider teamId="team" api={connection}><ConnectionSettings /><ResearchChat teamId="team" initialPapers={[]} initialConversations={[]} api={chat} /></LocalAgentProvider>);
  expect(screen.queryByRole("combobox", { name: "모델" })).toBeNull();
  const entry = screen.getByRole("button", { name: "AI 연결" });
  entry.focus(); await act(async () => { fireEvent.click(entry); });
  const model = await screen.findByRole("combobox", { name: "모델" });
  await waitFor(() => expect(model).toBeEnabled());
  fireEvent.change(model, { target: { value: "codex:second" } });
  expect(screen.queryByRole("radio", { name: "xhigh" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "high" }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: "AI 연결" }), { key: "Escape" });
  expect(entry).toHaveFocus();
  expect(screen.queryByRole("combobox", { name: "모델" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "연구 질문" }), { target: { value: "다음 아이디어를 같이 생각해줘" } });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await waitFor(() => expect(chat.send).toHaveBeenCalledWith("chat", expect.objectContaining({ model: "second", effort: "high" })));
});

it("접힌 사이드바의 설정 버튼에서도 연결과 모델을 설정할 수 있다", async () => {
  const { connection } = fixture();
  render(<LocalAgentProvider teamId="team" api={connection}><ConnectionSettings collapsed /></LocalAgentProvider>);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 연결" })); });
  expect(await screen.findByRole("dialog", { name: "AI 연결" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "연결 관리" })).toBeEnabled());
  expect(screen.getByText("연구용 PC")).toBeInTheDocument();
});

it("effort 지원 정보를 보내지 않는 기존 앱도 자유 대화는 하되 실행 옵션을 추정하지 않는다", async () => {
  const { connection, chat } = fixture();
  render(<LocalAgentProvider teamId="team" api={connection}><ConnectionSettings /><ResearchChat teamId="team" initialPapers={[]} initialConversations={[]} api={chat} /></LocalAgentProvider>);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 연결" })); });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "모델" })).toBeEnabled());
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(screen.queryByText("Effort")).toBeNull();
  fireEvent.keyDown(screen.getByRole("dialog", { name: "AI 연결" }), { key: "Escape" });
  fireEvent.change(screen.getByRole("textbox", { name: "연구 질문" }), { target: { value: "기존 앱으로 함께 생각해보자" } });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(1));
  const input = vi.mocked(chat.send).mock.calls[0][1];
  expect(input).toMatchObject({ provider: "codex", model: "first", paperIds: [], presentationIds: [] });
  expect(input).not.toHaveProperty("effort");
});

function catalogue(status: LocalAgentProviderStatus = "ready", deleted = false, id = "pc"): LocalAgentDeviceView {
  return { id, name: "연구용 PC", platform: "windows", online: true, lastSeenAt: null, leaseExpiresAt: null,
    providers: [
      { provider: "codex", status, models: [{ id: deleted ? "codex-other" : "codex-first", name: "Codex 모델" }], quota: null, observedAt: "2026-10-18T00:00:00Z" },
      { provider: "claude", status: "ready", models: [{ id: "haiku", name: "Claude 모델" }], quota: null, observedAt: "2026-10-18T00:00:00Z" },
    ] };
}

it.each([
  { reason: "로그인 필요", status: "login_required" as const, deleted: false },
  { reason: "사용 한도", status: "limited" as const, deleted: false },
  { reason: "모델 삭제", status: "ready" as const, deleted: true },
])("첫 Codex 질문 뒤 $reason 스냅샷은 전송을 막고 수동 교체만 허용한다", async ({ status, deleted }) => {
  const { connection, chat } = fixture();
  const initial = catalogue();
  connection.status.mockResolvedValue({ device: initial, devices: [initial] });
  vi.mocked(chat.send).mockResolvedValue({ id: "first-turn", conversationId: "chat", conversationTurn: 1, status: "completed", version: 1,
    provider: "codex", model: "codex-first", paperId: "", prompt: "첫 질문", response: "Codex 첫 답변", error: null,
    canCancel: false, contextTruncated: false, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z" });
  render(<LocalAgentProvider teamId="team" api={connection}><ConnectionSettings /><LocalAgentModelPicker /><ResearchChat teamId="team" initialPapers={[]} initialConversations={[]} api={chat} /></LocalAgentProvider>);
  const input = screen.getByRole("textbox", { name: "연구 질문" });
  fireEvent.change(input, { target: { value: "첫 질문" } });
  const send = screen.getByRole("button", { name: "보내기" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  expect(await screen.findByText("Codex 첫 답변")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeInTheDocument();
  expect(vi.mocked(chat.send).mock.calls[0][1]).toMatchObject({ provider: "codex", model: "codex-first" });
  fireEvent.change(input, { target: { value: "계속 이야기하자" } });
  const changed = catalogue(status, deleted);
  connection.status.mockResolvedValue({ device: changed, devices: [changed] });
  const calls = connection.status.mock.calls.length;
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(connection.status.mock.calls.length).toBeGreaterThan(calls));
  await waitFor(() => expect(send).toBeDisabled());
  fireEvent.click(send);
  expect(chat.send).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 연결" })); });
  const dialog = screen.getByRole("dialog", { name: "AI 연결" });
  const model = within(dialog).getByRole("combobox", { name: "모델" });
  expect(model).toHaveValue("");
  if (status === "ready") expect(model).toBeEnabled();
  else expect(model).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("tab", { name: "Claude Code" }));
  expect(model).toBeEnabled();
  fireEvent.change(model, { target: { value: "claude:haiku" } });
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  await waitFor(() => expect(chat.send).toHaveBeenCalledTimes(2));
  expect(vi.mocked(chat.send).mock.calls[1][1]).toMatchObject({ provider: "claude", model: "haiku" });
});

it("같은 팀·기기의 재마운트는 실패한 대상을 유지하고 새 팀·기기는 초기 선택을 한다", async () => {
  const { connection, chat } = fixture();
  const initial = catalogue();
  connection.status.mockResolvedValue({ device: initial, devices: [initial] });
  const view = (teamId = "team") => <LocalAgentProvider teamId={teamId} api={connection}><ConnectionSettings /><LocalAgentModelPicker /><ResearchChat teamId={teamId} initialPapers={[]} initialConversations={[]} api={chat} /></LocalAgentProvider>;
  let screenView = render(view());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 연결" })); });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "모델" })).toHaveValue("codex:codex-first"));
  const changed = catalogue("limited");
  connection.status.mockResolvedValue({ device: changed, devices: [changed] });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "모델" })).toHaveValue(""));
  screenView.unmount();
  screenView = render(view());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 연결" })); });
  await waitFor(() => expect(screen.getByRole("tab", { name: "Codex" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByRole("combobox", { name: "모델" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "모델" })).toHaveValue("");
  screenView.unmount();
  screenView = render(view("other-team"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 연결" })); });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "모델" })).toHaveValue("claude:haiku"));
  screenView.unmount();
  const otherDevice = catalogue("limited", false, "new-pc");
  connection.status.mockResolvedValue({ device: otherDevice, devices: [otherDevice] });
  render(view());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 연결" })); });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "모델" })).toHaveValue("claude:haiku"));
  fireEvent.keyDown(screen.getByRole("dialog", { name: "AI 연결" }), { key: "Escape" });
  expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeInTheDocument();
});
