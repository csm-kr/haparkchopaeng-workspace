import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalAgentDeviceView } from "@/types/local-agent";
import type { LocalAgentApi } from "../client";
import { ConnectionSettings } from "../connection-settings";
import { LocalAgentProvider, useLocalAgent } from "../provider";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });
afterEach(cleanup);

function device(): LocalAgentDeviceView {
  return { id: "pc", name: "연구용 PC", platform: "windows", online: true,
    lastSeenAt: null, leaseExpiresAt: null, providers: [
      { provider: "codex", status: "ready", models: [
        { id: "codex-first", name: "Codex 첫 모델", reasoningEfforts: ["low", "high"] },
        { id: "codex-other", name: "Codex 다른 모델" },
      ], quota: { short: null, weekly: { label: "7일 한도", remainingPercent: 44, resetsAt: null } }, observedAt: new Date().toISOString() },
      { provider: "claude", status: "ready", models: [{ id: "haiku", name: "Claude Haiku" }], quota: null, observedAt: new Date().toISOString() },
    ] };
}

function Selection() {
  const agent = useLocalAgent();
  return <output aria-label="선택 대상">{JSON.stringify({ explicit: agent?.selectedModel, target: agent?.chatTarget })}</output>;
}

function setup(collapsed = false, initial: LocalAgentDeviceView | null = device()) {
  const attempt = { id: "focus-attempt", version: 1, status: "awaiting_app" as const,
    code: "048217", device: null, expiresAt: new Date(Date.now() + 300_000).toISOString(),
    launchToken: "qa-launch", deepLink: "hapark-connect://connect?attemptId=focus-attempt&launchToken=qa-launch" };
  const api: LocalAgentApi = {
    status: vi.fn().mockResolvedValue({ device: initial, devices: initial ? [initial] : [] }),
    heartbeat: vi.fn().mockResolvedValue({ leaseExpiresAt: "2099-01-01T00:00:00Z" }),
    createAttempt: vi.fn().mockResolvedValue(attempt), getAttempt: vi.fn().mockResolvedValue(attempt), cancelAttempt: vi.fn(), disconnect: vi.fn(),
    downloads: vi.fn().mockResolvedValue({ releases: [] }), createJob: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn(),
  };
  render(<LocalAgentProvider teamId="team" api={api} launchConnector={() => true}><ConnectionSettings collapsed={collapsed} /><Selection /></LocalAgentProvider>);
  return api;
}

async function open() {
  const entry = screen.getByRole("button", { name: "AI 연결" });
  await waitFor(() => expect(entry).toHaveAccessibleDescription(/^연결됨/));
  entry.focus();
  await act(async () => { fireEvent.click(entry); });
  return screen.getByRole("dialog", { name: "AI 연결" });
}

it("사이드바는 현재 실제 모델과 20px 링을 보여 주고 한도 상세는 포커스할 때만 연다", async () => {
  const initial = device();
  initial.providers[0].quota!.weekly!.resetsAt = "2026-10-25T09:00:00.000Z";
  setup(false, initial);
  const entry = screen.getByRole("button", { name: "AI 연결" });
  await waitFor(() => expect(entry).toHaveAccessibleDescription(/연결됨/));
  expect(within(entry).getByText("Codex 첫 모델")).toBeVisible();
  expect(entry).toHaveAccessibleDescription(/Codex · Codex 첫 모델/);
  expect(entry.querySelector("button")).toBeNull();
  const quota = screen.getByRole("button", { name: "현재 모델 사용량 상세" });
  expect(within(quota).getByTestId("usage-ring")).toHaveAttribute("width", "20");
  expect(quota).not.toHaveTextContent("7d");
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(screen.queryByText("44% 남음")).toBeNull();
  act(() => { quota.focus(); });
  await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("7일 한도"));
  const detail = screen.getByRole("tooltip");
  expect(detail).toHaveTextContent("44% 남음");
  expect(detail).toHaveTextContent("초기화");
  expect(detail).toHaveTextContent("확인");
  expect(detail).toHaveTextContent("정확한 잔여 토큰 수를 의미하지 않아요");
  fireEvent.keyDown(quota, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("사이드바의 8px 점은 연결 상태를 알리고 접힌 상태에서도 같은 이름을 유지한다", async () => {
  const api = setup(true);
  const entry = screen.getByRole("button", { name: "AI 연결" });
  await waitFor(() => expect(entry).toHaveAccessibleDescription("연결됨 · Codex · Codex 첫 모델"));
  const dot = entry.querySelector("[data-connection-state]");
  expect(dot).toHaveClass("size-2", "bg-online");
  expect(entry.querySelector("svg")).toBeNull();
  expect(entry).toHaveAttribute("title", "AI 연결 · 연결됨 · Codex · Codex 첫 모델");
  expect(screen.queryByRole("button", { name: "현재 모델 사용량 상세" })).toBeNull();
  const offline = { ...device(), online: false };
  vi.mocked(api.status).mockResolvedValue({ device: offline, devices: [offline], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(entry).toHaveAccessibleDescription(/^다시 연결/));
  expect(dot).toHaveClass("bg-fg-faint");
  expect(dot).not.toHaveClass("bg-online");
});

it("도구 탭은 해당 실제 모델만 보여 주며 탭 이동만으로 실행 대상을 바꾸지 않는다", async () => {
  setup();
  const dialog = await open();
  const tabs = within(dialog).getByRole("tablist", { name: "AI 도구" });
  expect(within(tabs).getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Codex", "Claude Code"]);
  expect(within(tabs).getByRole("tab", { name: "Codex" })).toHaveAttribute("aria-selected", "true");
  const model = within(dialog).getByRole("combobox", { name: "모델" });
  expect(model).toHaveValue("codex:codex-first");
  expect(within(model).queryByRole("option", { name: "Claude Haiku" })).toBeNull();
  const before = screen.getByLabelText("선택 대상").textContent;
  fireEvent.click(within(tabs).getByRole("tab", { name: "Claude Code" }));
  expect(model).toHaveValue("");
  expect(within(model).getByRole("option", { name: "Claude Haiku" })).toBeInTheDocument();
  expect(within(model).queryByRole("option", { name: "Codex 첫 모델" })).toBeNull();
  expect(screen.getByLabelText("선택 대상")).toHaveTextContent(before!);
  expect(within(dialog).getByRole("button", { name: "지원 정보 없음" })).toBeDisabled();
  fireEvent.change(model, { target: { value: "claude:haiku" } });
  expect(screen.getByLabelText("선택 대상")).toHaveTextContent('"explicit":{"provider":"claude","model":"haiku"}');
  expect(within(dialog).queryAllByRole("radio")).toHaveLength(0);
  expect(within(dialog).getByText(/effort 지원 정보를 확인할 수 없어요/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "완료" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "AI 연결" })).toHaveFocus();
});

it("다른 도구 탭을 조회해도 사이드바의 실제 모델과 사용량은 수동 선택 전까지 유지한다", async () => {
  setup();
  const sidebar = screen.getByRole("group", { name: "AI 연결 상태" });
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole("tab", { name: "Claude Code" }));
  expect(within(sidebar).getByText("Codex 첫 모델")).toBeVisible();
  expect(within(sidebar).queryByText("Claude Haiku")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "완료" }));
  const quota = within(sidebar).getByRole("button", { name: "현재 모델 사용량 상세" });
  fireEvent.pointerEnter(quota, { pointerType: "mouse" });
  expect(screen.getByRole("tooltip")).toHaveTextContent("44% 남음");
  fireEvent.keyDown(quota, { key: "Escape" });
  const reopened = await open();
  fireEvent.click(within(reopened).getByRole("tab", { name: "Claude Code" }));
  fireEvent.change(within(reopened).getByRole("combobox", { name: "모델" }), { target: { value: "claude:haiku" } });
  fireEvent.click(within(reopened).getByRole("button", { name: "완료" }));
  expect(within(sidebar).getByText("Claude Haiku")).toBeVisible();
  expect(within(sidebar).queryByText("Codex 첫 모델")).toBeNull();
  const changedQuota = within(sidebar).getByRole("button", { name: "현재 모델 사용량 상세" });
  expect(within(changedQuota).getByTestId("usage-ring")).toHaveAttribute("data-state", "unknown");
  fireEvent.focus(changedQuota);
  expect(screen.getByRole("tooltip")).toHaveTextContent("정보를 제공하지 않아요");
  expect(screen.getByRole("tooltip")).not.toHaveTextContent("44% 남음");
});

it.each([
  { reason: "미제공", remaining: null, age: 0, state: "unknown", text: "정보를 제공하지 않아요" },
  { reason: "오래된 관측값", remaining: 44, age: 120_000, state: "stale", text: "44% 남음" },
  { reason: "실제 0%", remaining: 0, age: 0, state: "empty", text: "0% 남음" },
])("사이드바에서 $reason 사용량을 구분한다", async ({ remaining, age, state, text }) => {
  const initial = device();
  const provider = initial.providers[0];
  provider.quota = remaining === null ? null : { short: null, weekly: { label: "7일 한도", remainingPercent: remaining, resetsAt: null } };
  provider.quotaObservedAt = new Date(Date.now() - age).toISOString();
  setup(false, initial);
  const quota = await screen.findByRole("button", { name: "현재 모델 사용량 상세" });
  expect(within(quota).getByTestId("usage-ring")).toHaveAttribute("data-state", state);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.focus(quota);
  expect(screen.getByRole("tooltip")).toHaveTextContent(text);
  if (age) expect(screen.getByRole("tooltip")).toHaveTextContent("이전 확인값");
  else expect(screen.getByRole("tooltip")).not.toHaveTextContent("이전 확인값");
});

it("실제 effort 범위와 20px 사용량 링을 재사용하고 키보드로 도구를 탐색한다", async () => {
  setup();
  const dialog = await open();
  expect(within(dialog).getAllByRole("radio").map(radio => radio.getAttribute("value"))).toEqual(["low", "high"]);
  expect(within(dialog).getByRole("radio", { name: "low" })).toHaveAttribute("value", "low");
  expect(within(dialog).getByRole("radio", { name: "high" })).toHaveAttribute("value", "high");
  expect(within(dialog).queryByRole("radio", { name: "medium" })).toBeNull();
  const ring = within(dialog).getByTestId("usage-ring");
  expect(ring).toHaveAttribute("width", "20");
  const quota = within(dialog).getByRole("button", { name: "사용량 상세" });
  fireEvent.focus(quota);
  expect(screen.getByRole("tooltip")).toHaveTextContent("44% 남음");
  fireEvent.keyDown(quota, { key: "Escape" });
  const codex = within(dialog).getByRole("tab", { name: "Codex" });
  codex.focus();
  fireEvent.keyDown(codex, { key: "ArrowRight" });
  const claude = within(dialog).getByRole("tab", { name: "Claude Code" });
  expect(claude).toHaveFocus();
  expect(claude).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(claude, { key: "Home" });
  expect(codex).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "AI 연결" })).toHaveFocus();
});

it("모델이 지원하는 다섯 effort 이름을 원문으로 표시한다", async () => {
  const initial = device();
  initial.providers[0].models[0].reasoningEfforts = ["low", "medium", "high", "xhigh", "max"];
  setup(false, initial);
  const dialog = await open();
  const radios = within(dialog).getAllByRole("radio");
  expect(radios).toHaveLength(5);
  for (const name of ["low", "medium", "high", "xhigh", "max"]) {
    expect(within(dialog).getByRole("radio", { name })).toHaveAttribute("value", name);
  }
});

it("갱신 순서가 바뀌어도 현재 도구를 유지하고 모델 삭제 시 다른 모델을 고르지 않는다", async () => {
  const api = setup();
  const dialog = await open();
  const changed = device();
  changed.providers[0].models = [{ id: "codex-other", name: "Codex 다른 모델" }];
  changed.providers.reverse();
  vi.mocked(api.status).mockResolvedValue({ device: changed, devices: [changed], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  const model = within(dialog).getByRole("combobox", { name: "모델" });
  await waitFor(() => expect(model).toHaveValue(""));
  expect(within(dialog).getByRole("tab", { name: "Codex" })).toHaveAttribute("aria-selected", "true");
  expect(within(dialog).getByText(/사용하던 모델을 사용할 수 없어요/)).toBeInTheDocument();
  expect(screen.getByLabelText("선택 대상")).toHaveTextContent('"model":"codex-first"');
  const sidebar = screen.getByRole("group", { name: "AI 연결 상태" });
  expect(within(sidebar).getByText("모델 선택 필요")).toBeVisible();
  expect(within(sidebar).queryByText("Codex 다른 모델")).toBeNull();
  expect(within(sidebar).queryByText("Claude Haiku")).toBeNull();
  expect(model).toBeEnabled();
  fireEvent.change(model, { target: { value: "codex:codex-other" } });
  expect(model).toHaveValue("codex:codex-other");
  expect(within(sidebar).getByText("Codex 다른 모델")).toBeVisible();
});

it("미설치 도구를 조회해도 가짜 모델이나 effort를 추가하지 않는다", async () => {
  const initial = device();
  initial.providers[1] = { ...initial.providers[1], status: "not_installed", models: [] };
  setup(false, initial);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole("tab", { name: "Claude Code" }));
  expect(within(dialog).getByRole("combobox", { name: "모델" })).toBeDisabled();
  expect(within(dialog).getByText(/Claude Code 설치 안내/)).toBeInTheDocument();
  expect(within(dialog).queryAllByRole("radio")).toHaveLength(0);
  expect(within(dialog).queryByTestId("usage-ring")).toBeNull();
});

it.each([
  { action: "연결하기", initial: null },
  { action: "연결 관리", initial: device() },
])("설정에서 $action 창으로 전환한 뒤 닫으면 사이드바에 포커스를 돌린다", async ({ action, initial }) => {
  const api = setup(false, initial);
  const entry = screen.getByRole("button", { name: "AI 연결" });
  await waitFor(() => expect(entry).toHaveAccessibleDescription(initial ? /^연결됨/ : /^AI 연결/));
  entry.focus();
  await act(async () => { fireEvent.click(entry); });
  const settings = screen.getByRole("dialog", { name: "AI 연결" });
  const next = within(settings).getByRole("button", { name: action });
  next.focus();
  await act(async () => { fireEvent.click(next); });
  expect(settings.isConnected).toBe(false);
  const connection = screen.getByRole("dialog", { name: "AI 연결" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  const close = within(connection).getByRole("button", { name: "연결창 닫기" });
  close.focus();
  fireEvent.click(close);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(entry).toHaveFocus();
  expect(document.body.style.overflow).not.toBe("hidden");
  if (!initial) expect(api.createAttempt).toHaveBeenCalledOnce();
});
