import * as React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalAgentDeviceView, LocalAgentStatus } from "@/types/local-agent";
import { LocalAgentApiError, type LocalAgentApi } from "../client";
import { LocalAgentModelPicker } from "../model-picker";
import { LocalAgentProvider, useLocalAgent } from "../provider";

const key = "hapark.local-agent.device:team-a";
const pc: LocalAgentDeviceView = {
  id: "this-pc", name: "이 PC", platform: "windows", online: true,
  lastSeenAt: new Date().toISOString(), leaseExpiresAt: "2099-01-01T00:00:00Z",
  providers: [{ provider: "codex", status: "ready", models: [{ id: "actual", name: "실제 모델" }], quota: null, observedAt: new Date().toISOString() }],
};
const other: LocalAgentDeviceView = { ...pc, id: "other-pc", name: "다른 PC" };

function apiFixture() {
  return {
    // The real server never chooses a device from devices[] without its exact ID.
    status: vi.fn<LocalAgentApi["status"]>().mockImplementation(async id => ({
      device: id === pc.id ? pc : null, devices: [other, pc], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15,
    })),
    heartbeat: vi.fn().mockResolvedValue({ leaseExpiresAt: "2099-01-01T00:00:00Z" }),
    downloads: vi.fn().mockResolvedValue({ releases: [] }),
    createAttempt: vi.fn(), getAttempt: vi.fn(), cancelAttempt: vi.fn(), disconnect: vi.fn(),
    createJob: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn(), openTerminal: vi.fn(), activeJobs: vi.fn().mockResolvedValue([]),
  } satisfies LocalAgentApi;
}

function State() {
  const agent = useLocalAgent();
  return <output aria-label="연결 상태">{agent?.phase}</output>;
}
function view(api: LocalAgentApi) {
  return <React.StrictMode><LocalAgentProvider teamId="team-a" api={api}>
    <State /><LocalAgentModelPicker />
  </LocalAgentProvider></React.StrictMode>;
}

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("같은 브라우저의 새 탭도 연결했던 정확한 기기를 재검증하고 모델 선택을 활성화한다", async () => {
  const api = apiFixture();
  window.sessionStorage.setItem(key, pc.id);
  const first = render(view(api));
  await waitFor(() => expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeEnabled());
  expect(api.status).toHaveBeenCalledWith(pc.id);
  first.unmount();

  // A fresh tab has its own empty sessionStorage, while origin localStorage survives.
  window.sessionStorage.clear();
  api.status.mockClear(); api.heartbeat.mockClear();
  render(view(api));
  await waitFor(() => expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeEnabled());
  expect(api.status).toHaveBeenCalledWith(pc.id);
  expect(api.heartbeat).toHaveBeenCalledWith(pc.id);
  expect(api.createAttempt).not.toHaveBeenCalled();
});

it("이미 열린 탭도 다른 탭에서 승인한 기기 힌트를 서버로 확인한 후 활성화한다", async () => {
  const api = apiFixture();
  render(view(api));
  await waitFor(() => expect(screen.getByLabelText("연결 상태")).toHaveTextContent("idle"));
  expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeDisabled();
  window.localStorage.setItem(key, pc.id);
  await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key, newValue: pc.id, storageArea: window.localStorage })); });
  await waitFor(() => expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeEnabled());
  expect(api.status).toHaveBeenCalledWith(pc.id);
  expect(api.createAttempt).not.toHaveBeenCalled();
});

it("이 PC 힌트가 없으면 다른 온라인 PC 목록만으로 모델 선택을 열지 않는다", async () => {
  const api = apiFixture();
  render(view(api));
  await waitFor(() => expect(screen.getByLabelText("연결 상태")).toHaveTextContent("idle"));
  expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeDisabled();
  expect(api.heartbeat).not.toHaveBeenCalled();
  window.localStorage.setItem("hapark.local-agent.device:another-team", pc.id);
  await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: "hapark.local-agent.device:another-team", newValue: pc.id, storageArea: window.localStorage })); });
  expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeDisabled();
  expect(api.heartbeat).not.toHaveBeenCalled();
});

it("저장된 기기라도 현재 세션의 허가가 없으면 모델과 heartbeat를 허용하지 않는다", async () => {
  const api = apiFixture();
  api.status.mockResolvedValue({ device: null, devices: [other, pc], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 });
  window.localStorage.setItem(key, pc.id);
  render(view(api));
  await waitFor(() => expect(screen.getByLabelText("연결 상태")).toHaveTextContent("idle"));
  expect(api.status).toHaveBeenCalledWith(pc.id);
  expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeDisabled();
  expect(api.heartbeat).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(key)).toBeNull();
});

it("로그인 만료 시 공유 기기 힌트를 지우고 다시 연결하도록 한다", async () => {
  const api = apiFixture();
  api.status.mockRejectedValue(new LocalAgentApiError(401, "UNAUTHORIZED"));
  window.localStorage.setItem(key, pc.id);
  render(view(api));
  await waitFor(() => expect(screen.getByLabelText("연결 상태")).toHaveTextContent("login_required"));
  expect(window.localStorage.getItem(key)).toBeNull();
  expect(api.heartbeat).not.toHaveBeenCalled();
});

it("지연된 이전 상태 응답이 다른 탭에서 새로 승인한 기기 힌트를 덮어쓰지 않는다", async () => {
  const api = apiFixture();
  const replies: Array<(value: LocalAgentStatus) => void> = [];
  api.status.mockImplementation(() => new Promise(resolve => replies.push(resolve)));
  window.localStorage.setItem(key, pc.id);
  render(view(api));
  await waitFor(() => expect(replies.length).toBeGreaterThan(0));
  // Native storage events may arrive after an earlier network reply.
  window.localStorage.setItem(key, other.id);
  await act(async () => { replies.forEach(resolve => resolve({ device: pc, devices: [pc, other], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 })); });
  expect(window.localStorage.getItem(key)).toBe(other.id);
  expect(api.heartbeat).not.toHaveBeenCalled();
});

it("같은 기기의 새 승인이 있어도 이전 heartbeat의 지연된 권한 오류로 연결을 지우지 않는다", async () => {
  const api = apiFixture();
  let rejectHeartbeat!: (reason: unknown) => void;
  api.heartbeat.mockImplementationOnce(() => new Promise((_, reject) => { rejectHeartbeat = reject; }));
  window.localStorage.setItem(key, pc.id);
  render(view(api));
  await waitFor(() => expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeEnabled());
  await waitFor(() => expect(api.heartbeat).toHaveBeenCalledWith(pc.id));
  const renewed = JSON.stringify({ deviceId: pc.id, revision: "new-approval" });
  window.localStorage.setItem(key, renewed);
  await act(async () => { rejectHeartbeat(new LocalAgentApiError(403, "FORBIDDEN")); });
  expect(window.localStorage.getItem(key)).toBe(renewed);
  expect(screen.getByLabelText("연결 상태")).toHaveTextContent("connected");
  expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeEnabled();
});
