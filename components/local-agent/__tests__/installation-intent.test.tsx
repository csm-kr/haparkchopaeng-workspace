import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocalAgentProvider } from "../provider";
import { ConnectionSettings } from "../connection-settings";
import { LocalAgentSettingsCard } from "../settings-card";
import type { LocalAgentApi } from "../client";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); window.history.replaceState(null, "", "/profile"); vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function fixture() {
  const release = { platform: "windows" as const, architecture: "x64" as const, version: "0.1.5", url: "https://downloads.example/bridge.exe" };
  const attempt = { id: "new-attempt", version: 1, status: "awaiting_app" as const, code: "123456", device: null,
    expiresAt: new Date(Date.now() + 300_000).toISOString(), launchToken: "token", deepLink: "hapark-connect://connect?attemptId=new-attempt&launchToken=token" };
  const api = { status: vi.fn().mockResolvedValue({ device: null, devices: [] }), downloads: vi.fn().mockResolvedValue({ releases: [release] }),
    createAttempt: vi.fn().mockResolvedValue(attempt), getAttempt: vi.fn(), cancelAttempt: vi.fn(), heartbeat: vi.fn(), disconnect: vi.fn(), createJob: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn() } satisfies LocalAgentApi;
  const launch = vi.fn(() => true);
  render(<LocalAgentProvider teamId="team" api={api} launchConnector={launch}><ConnectionSettings /><LocalAgentSettingsCard /></LocalAgentProvider>);
  return { api, launch, attempt };
}

it("처음 연결창에서는 서버 요청을 하지 않고 설치를 고른 뒤 파일과 단계별 안내를 제공한다", async () => {
  const { api, launch, attempt } = fixture();
  await waitFor(() => expect(api.status).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "AI 연결 관리" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.queryByRole("textbox", { name: "논문 질문" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "모델" })).toBeNull();
  expect(api.downloads).not.toHaveBeenCalled();
  expect(api.createAttempt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "설치 파일 받기" }));
  const download = await screen.findByRole("link", { name: "AI 브릿지 받기" });
  expect(download).toHaveAttribute("href", "https://downloads.example/bridge.exe");
  expect(screen.getByRole("heading", { name: "AI 브릿지 설치" })).toHaveFocus();
  expect(screen.getByText(/받은 설치 파일을 열어 설치를 마친 뒤/)).toBeVisible();
  download.addEventListener("click", event => event.preventDefault(), { once: true });
  fireEvent.click(download);
  expect(screen.getByText(/설치 파일을 요청했어요/)).toBeVisible();
  expect(api.createAttempt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "설치 후 연결하기" }));
  await waitFor(() => expect(api.createAttempt).toHaveBeenCalledOnce());
  expect(launch).toHaveBeenCalledWith(attempt.deepLink);
});

it("설치 파일 조회 실패는 재시도할 수 있고 미배포 상태와 구분한다", async () => {
  const { api } = fixture();
  api.downloads.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ releases: [] });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 연결" })); });
  fireEvent.click(screen.getByRole("button", { name: "설치 파일 받기" }));
  expect(await screen.findByRole("button", { name: "설치 파일을 확인하지 못했어요" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "설치 파일 다시 확인" }));
  expect(await screen.findByText("이 환경의 설치 파일이 아직 배포되지 않았어요.")).toBeVisible();
  expect(api.downloads).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("link", { name: "AI 브릿지 받기" })).toBeNull();
});

it("열기 실패 뒤 설치를 마치고 연결하면 이전 링크를 재사용하지 않고 새 시도를 만든다", async () => {
  const { api, launch } = fixture();
  await waitFor(() => expect(api.status).toHaveBeenCalled());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 연결" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AI 브릿지 열기" })); });
  fireEvent.click(screen.getByRole("button", { name: "AI 브릿지가 열리지 않아요" }));
  await screen.findByRole("link", { name: "AI 브릿지 받기" });
  fireEvent.click(screen.getByRole("button", { name: "설치 후 연결하기" }));
  await waitFor(() => expect(api.createAttempt).toHaveBeenCalledTimes(2));
  expect(launch).toHaveBeenCalledTimes(2);
});
