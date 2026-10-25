import * as React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalAgentAttemptView, LocalAgentDeviceView } from "@/types/local-agent";
import { LocalAgentApiError, type LocalAgentApi } from "../client";
import { LocalAgentProvider, useLocalAgent } from "../provider";

const deviceKey = "hapark.local-agent.device:team-a";
const attemptKey = "hapark.local-agent.attempt:team-a";
const oldDevice: LocalAgentDeviceView = {
  id: "previous-pc", name: "이전 PC", platform: "windows", online: true,
  lastSeenAt: "2026-10-18T00:00:00Z", leaseExpiresAt: "2099-01-01T00:00:00Z",
  providers: [{ provider: "codex", status: "ready", models: [{ id: "actual-model", name: "실제 모델" }], quota: null, observedAt: "2026-10-18T00:00:00Z" }],
};
const peerDevice: LocalAgentDeviceView = { ...oldDevice, id: "newly-approved-pc", name: "새로 승인한 PC" };
const peerApproval = JSON.stringify({ deviceId: peerDevice.id, revision: "newer-peer-approval" });
const pending: LocalAgentAttemptView = {
  id: "saved-attempt", version: 1, status: "awaiting_app", expiresAt: "2099-01-01T00:00:00Z", code: "123456", device: null,
};
const connected: LocalAgentAttemptView = { ...pending, version: 2, status: "connected", code: null, device: oldDevice };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  return {
    // Match GET /status: a list alone never identifies the requesting browser's PC.
    status: vi.fn<LocalAgentApi["status"]>().mockImplementation(async id => ({
      device: id === oldDevice.id ? oldDevice : id === peerDevice.id ? peerDevice : null,
      devices: [oldDevice, peerDevice], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15,
    })),
    heartbeat: vi.fn<LocalAgentApi["heartbeat"]>().mockResolvedValue({ leaseExpiresAt: "2099-01-01T00:00:00Z" }),
    createAttempt: vi.fn<LocalAgentApi["createAttempt"]>(),
    getAttempt: vi.fn<LocalAgentApi["getAttempt"]>(),
    cancelAttempt: vi.fn<LocalAgentApi["cancelAttempt"]>().mockResolvedValue({ cancelled: true }),
    disconnect: vi.fn<LocalAgentApi["disconnect"]>().mockResolvedValue({ revoked: true }),
    downloads: vi.fn<LocalAgentApi["downloads"]>().mockResolvedValue({ releases: [] }),
    createJob: vi.fn<LocalAgentApi["createJob"]>(),
    getJob: vi.fn<LocalAgentApi["getJob"]>(),
    cancelJob: vi.fn<LocalAgentApi["cancelJob"]>(), openTerminal: vi.fn<LocalAgentApi["openTerminal"]>(), activeJobs: vi.fn<LocalAgentApi["activeJobs"]>().mockResolvedValue([]),
  } satisfies LocalAgentApi;
}

function State() {
  const agent = useLocalAgent();
  return <output aria-label="연결 상태">{JSON.stringify({ phase: agent?.phase, deviceId: agent?.device?.id ?? null })}</output>;
}

async function mount(api: LocalAgentApi) {
  await act(async () => {
    render(<LocalAgentProvider teamId="team-a" api={api} launchConnector={() => true}><State /></LocalAgentProvider>);
  });
}

function state() {
  return JSON.parse(screen.getByLabelText("연결 상태").textContent ?? "null");
}

function approvePeerBeforeStorageEvent() {
  // Another tab has committed its approval; this tab's native storage event is still queued.
  window.localStorage.setItem(deviceKey, peerApproval);
}

beforeEach(() => {
  window.sessionStorage.clear(); window.localStorage.clear();
  window.sessionStorage.setItem(attemptKey, pending.id);
  vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("초기 pending 복원의 늦은 연결 완료가 다른 탭의 새 승인을 덮어쓰지 않는다", async () => {
  const api = fixture();
  const response = deferred<LocalAgentAttemptView>();
  api.getAttempt.mockReturnValue(response.promise);
  await mount(api);
  expect(api.status).toHaveBeenCalledWith(null);
  expect(api.getAttempt).toHaveBeenCalledWith(pending.id);

  approvePeerBeforeStorageEvent();
  await act(async () => { response.resolve(connected); });

  expect(window.localStorage.getItem(deviceKey)).toBe(peerApproval);
  expect(state().deviceId).toBeNull();
  expect(api.heartbeat).not.toHaveBeenCalled();
});

async function beginPoll() {
  const api = fixture();
  const response = deferred<LocalAgentAttemptView>();
  api.getAttempt.mockResolvedValueOnce(pending).mockReturnValue(response.promise);
  await mount(api);
  expect(state()).toEqual({ phase: "opening", deviceId: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(api.getAttempt).toHaveBeenCalledTimes(2);
  return { api, response };
}

it("예약된 이전 연결 폴링이 시작되기 전에 다른 탭이 승인했으면 요청을 보내지 않는다", async () => {
  const api = fixture();
  api.getAttempt.mockResolvedValueOnce(pending).mockResolvedValue(connected);
  await mount(api);
  expect(state()).toEqual({ phase: "opening", deviceId: null });

  approvePeerBeforeStorageEvent();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

  expect(api.getAttempt).toHaveBeenCalledTimes(1);
  expect(window.localStorage.getItem(deviceKey)).toBe(peerApproval);
  expect(state().deviceId).toBeNull();
  expect(api.heartbeat).not.toHaveBeenCalled();
});

it("활성 pending 폴링의 늦은 연결 완료가 다른 탭의 새 승인을 덮어쓰지 않는다", async () => {
  const { api, response } = await beginPoll();
  approvePeerBeforeStorageEvent();
  await act(async () => { response.resolve(connected); });

  expect(window.localStorage.getItem(deviceKey)).toBe(peerApproval);
  expect(state()).toEqual({ phase: "opening", deviceId: null });
  expect(api.heartbeat).not.toHaveBeenCalled();
});

it.each([401, 403])("활성 pending 폴링의 지연된 %i 오류가 새 승인을 로그인 만료로 바꾸지 않는다", async status => {
  const { api, response } = await beginPoll();
  approvePeerBeforeStorageEvent();
  await act(async () => { response.reject(new LocalAgentApiError(status, status === 401 ? "UNAUTHORIZED" : "FORBIDDEN")); });

  expect(window.localStorage.getItem(deviceKey)).toBe(peerApproval);
  expect(state()).toEqual({ phase: "opening", deviceId: null });
  expect(api.heartbeat).not.toHaveBeenCalled();
});
