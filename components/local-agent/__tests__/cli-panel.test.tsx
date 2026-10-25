import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalAgentActiveJobView, LocalAgentDeviceView } from "@/types/local-agent";
import { LocalAgentApiError, type LocalAgentApi } from "../client";
import { ConnectionSettings } from "../connection-settings";
import { LocalAgentProvider } from "../provider";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });
afterEach(cleanup);

function device(overrides: Partial<LocalAgentDeviceView> = {}): LocalAgentDeviceView {
  return { id: "pc", name: "연구용 PC", platform: "macos", online: true, lastSeenAt: null, leaseExpiresAt: null, bridgeVersion: "0.1.13", bridgeCapabilities: ["terminal_v1"], providers: [
    { provider: "codex", status: "ready", models: [{ id: "codex-model", name: "Codex 모델" }], quota: null, observedAt: new Date().toISOString() },
    { provider: "claude", status: "not_installed", models: [], quota: null, observedAt: new Date().toISOString() },
  ], ...overrides };
}
const now = new Date().toISOString();
const chatJob: LocalAgentActiveJobView = { id: "job-chat", kind: "chat", provider: "codex", model: "codex-model", status: "running", createdAt: now, href: "/ai-chat/conversation", canCancel: true };
const analysisJob: LocalAgentActiveJobView = { id: "job-analysis", kind: "paper_analysis", provider: "codex", model: "codex-model", status: "queued", createdAt: now, href: "/papers/p#local-paper-analysis", canCancel: false };

function setup(initial = device(), jobs: LocalAgentActiveJobView[] = []) {
  const api: LocalAgentApi = {
    status: vi.fn().mockResolvedValue({ device: initial, devices: [initial] }),
    heartbeat: vi.fn().mockResolvedValue({ leaseExpiresAt: "2099-01-01T00:00:00Z" }),
    createAttempt: vi.fn(), getAttempt: vi.fn(), cancelAttempt: vi.fn(), disconnect: vi.fn(),
    downloads: vi.fn().mockResolvedValue({ releases: [] }), createJob: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn().mockResolvedValue({}),
    openTerminal: vi.fn().mockResolvedValue({ requestId: "request", expiresAt: now }), activeJobs: vi.fn().mockResolvedValue(jobs),
  };
  render(<LocalAgentProvider teamId="team" api={api} launchConnector={() => true}><ConnectionSettings collapsed={false} /></LocalAgentProvider>);
  return api;
}
async function open() {
  const entry = screen.getByRole("button", { name: "AI 연결" });
  await waitFor(() => expect(entry).toHaveAccessibleDescription(/^연결됨/));
  await act(async () => { fireEvent.click(entry); });
  return screen.getByRole("dialog", { name: "AI 연결" });
}

it("터미널 열기는 누를 때만 연결된 PC에 요청하고 그 PC 이름을 알려 준다", async () => {
  const api = setup();
  const dialog = await open();
  expect(api.openTerminal).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Codex 터미널 열기" }));
  await waitFor(() => expect(api.openTerminal).toHaveBeenCalledWith("pc", "codex"));
  expect(await within(dialog).findByText("연결된 PC(연구용 PC)에서 터미널을 여는 중이에요. 몇 초 안에 열려요.")).toBeInTheDocument();
});

it("설치되지 않은 도구에는 터미널 버튼을 두지 않는다", async () => {
  setup();
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole("tab", { name: "Claude Code" }));
  expect(within(dialog).queryByRole("button", { name: "Claude Code 터미널 열기" })).toBeNull();
});

it("터미널 열기를 지원하지 않는 이전 앱에는 업데이트 안내를 보인다", async () => {
  setup(device({ bridgeVersion: "0.1.12", bridgeCapabilities: [] }));
  const dialog = await open();
  expect(within(dialog).queryByRole("button", { name: "Codex 터미널 열기" })).toBeNull();
  expect(within(dialog).getByText("터미널 열기는 AI 브릿지 0.1.13부터 쓸 수 있어요.")).toBeInTheDocument();
});

it("터미널 요청이 거절되면 이유를 알려 준다", async () => {
  const api = setup();
  vi.mocked(api.openTerminal).mockRejectedValueOnce(new LocalAgentApiError(409, "CONNECTOR_UPDATE_REQUIRED")).mockRejectedValueOnce(new LocalAgentApiError(409, "PROVIDER_NOT_INSTALLED"));
  const dialog = await open();
  const button = within(dialog).getByRole("button", { name: "Codex 터미널 열기" });
  fireEvent.click(button);
  expect(await within(dialog).findByText("터미널을 열려면 AI 브릿지를 업데이트해 주세요.")).toBeInTheDocument();
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await within(dialog).findByText("연결된 PC에 이 CLI가 설치돼 있지 않아요.")).toBeInTheDocument();
});

it("실행 중인 작업을 보여 주고 AI 채팅 답변만 웹에서 멈춘다", async () => {
  const api = setup(device(), [chatJob, analysisJob]);
  const dialog = await open();
  const region = await within(dialog).findByRole("region", { name: "실행 중인 작업" });
  const chatRow = await within(region).findByRole("listitem", { name: /AI 채팅/ });
  expect(chatRow).toHaveTextContent("Codex · codex-model");
  expect(chatRow).toHaveTextContent("실행 중");
  const analysisRow = within(region).getByRole("listitem", { name: /논문 분석/ });
  expect(analysisRow).toHaveTextContent("대기 중");
  expect(within(analysisRow).queryByRole("button", { name: "멈추기" })).toBeNull();
  expect(within(analysisRow).getByRole("link", { name: "열기" })).toHaveAttribute("href", "/papers/p#local-paper-analysis");
  vi.mocked(api.activeJobs).mockResolvedValue([analysisJob]);
  fireEvent.click(within(chatRow).getByRole("button", { name: "멈추기" }));
  await waitFor(() => expect(api.cancelJob).toHaveBeenCalledWith("job-chat"));
  await waitFor(() => expect(within(region).queryByRole("listitem", { name: /AI 채팅/ })).toBeNull());
});

it("작업이 없으면 빈 상태를, 조회에 실패하면 다시 시도를 보인다", async () => {
  const api = setup();
  vi.mocked(api.activeJobs).mockRejectedValueOnce(new LocalAgentApiError(503, "UNAVAILABLE"));
  const dialog = await open();
  const region = await within(dialog).findByRole("region", { name: "실행 중인 작업" });
  expect(await within(region).findByText("실행 중인 작업을 확인하지 못했어요.")).toBeInTheDocument();
  fireEvent.click(within(region).getByRole("button", { name: "다시 시도" }));
  expect(await within(region).findByText("지금 실행 중인 작업이 없어요.")).toBeInTheDocument();
});
