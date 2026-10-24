import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BridgeUpdateInfo } from "../bridge-update";
import type { ConnectorRelease } from "../client";

const context = vi.hoisted(() => ({ use: vi.fn() }));
vi.mock("../provider", () => ({ useLocalAgent: context.use }));
const win: ConnectorRelease = { platform: "windows", architecture: "x64", version: "0.1.5", url: "https://downloads.example/0.1.5.exe", unsigned: true };

function setup(version: string | null, releases: ConnectorRelease[] = [win], platform = "windows", architecture: string | null = "x64") {
  const downloads = vi.fn().mockResolvedValue({ releases });
  const value = { phase: "connected", api: { downloads }, device: { platform, bridgeVersion: version, bridgeArchitecture: architecture } };
  context.use.mockReturnValue(value);
  return { ...render(<BridgeUpdateInfo />), downloads, value };
}

beforeEach(() => { vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); context.use.mockReset(); delete (navigator as { userAgentData?: unknown }).userAgentData; });

const arm: ConnectorRelease = { ...win, platform: "macos", architecture: "arm64", url: "https://downloads.example/arm.dmg" };
const intel: ConnectorRelease = { ...arm, architecture: "x64", url: "https://downloads.example/intel.dmg" };
const macNotice = "테스트 버전 · 게시자 서명 없음 · 처음 열 때 막히면 시스템 설정 > 개인정보 보호 및 보안에서 '그래도 열기'를 눌러 주세요.";

describe("실제 설치 앱과 최신 파일의 업데이트 안내", () => {
  it("구버전과 게시 버전을 함께 보여주고 다운로드만으로 설치 완료를 주장하지 않는다", async () => {
    const { value, rerender } = setup("0.1.2");
    const link = await screen.findByRole("link", { name: "업데이트 받기" });
    expect(link).toHaveAttribute("href", win.url);
    expect(link).toHaveAccessibleDescription(/서명 없음/);
    expect(screen.getByText("설치 0.1.2")).toBeVisible();
    expect(screen.getByText("최신 0.1.5")).toBeVisible();
    link.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(link);
    expect(screen.getByText(/설치 파일을 요청했어요/)).toBeVisible();
    expect(screen.getByText("설치 0.1.2")).toBeVisible();
    expect(screen.queryByText("최신 버전이에요")).toBeNull();
    value.device.bridgeVersion = "0.1.5";
    rerender(<BridgeUpdateInfo />);
    expect(screen.getByText("최신 버전이에요")).toBeVisible();
    expect(screen.queryByRole("link", { name: "업데이트 받기" })).toBeNull();
  });

  it("파일 요청 뒤 실제 설치를 마친 앱에 다시 연결할 수 있다", async () => {
    const downloads = vi.fn().mockResolvedValue({ releases: [win] });
    context.use.mockReturnValue({ phase: "connected", api: { downloads }, device: { platform: "windows", bridgeVersion: "0.1.2", bridgeArchitecture: "x64" } });
    const onReconnect = vi.fn();
    render(<BridgeUpdateInfo onReconnect={onReconnect} />);
    const link = await screen.findByRole("link", { name: "업데이트 받기" });
    link.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(link);
    expect(screen.getByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", win.url);
    expect(screen.getByText(/설치 파일을 요청했어요/)).toBeVisible();
    expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["설치 후 다시 연결"]);
    fireEvent.click(screen.getByRole("button", { name: "설치 후 다시 연결" }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("설치 버전을 보고하지 않는 구 앱을 최신으로 표시하지 않는다", async () => {
    setup(null);
    expect(await screen.findByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", win.url);
    expect(screen.queryByText("설치 버전 미확인")).toBeNull();
    expect(screen.queryByText("최신 0.1.5")).toBeNull();
    expect(screen.queryByText(/최신 설치 파일로 업데이트하면/)).toBeNull();
    expect(screen.queryByText("최신 버전이에요")).toBeNull();
  });

  it.each(["0.1.5", "0.10.0"])("같거나 더 높은 설치 버전 %s에는 다운그레이드 링크를 제공하지 않는다", async version => {
    setup(version);
    expect(await screen.findByText(version === "0.1.5" ? "최신 버전이에요" : "설치 버전이 더 최신이에요")).toBeVisible();
    expect(screen.queryByRole("link", { name: "업데이트 받기" })).toBeNull();
  });

  it("연결된 앱이 알려준 Mac 칩을 먼저 쓰고, 모르면 Apple Silicon 파일을 버튼 하나로 준다", async () => {
    const { value, rerender } = setup("0.1.2", [arm, intel], "macos", "x64");
    expect(await screen.findByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", intel.url);
    expect(screen.getByText("Mac · Intel용 · 0.1.5")).toBeVisible();
    value.device.bridgeArchitecture = null;
    rerender(<BridgeUpdateInfo />);
    const link = screen.getByRole("link", { name: "업데이트 받기" });
    expect(link).toHaveAttribute("href", arm.url);
    expect(link).toHaveAccessibleDescription(macNotice);
    expect(screen.getByText("Mac · Apple Silicon용 · 0.1.5")).toBeVisible();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByLabelText("칩 종류")).not.toBeVisible();
    expect(screen.getByText("Intel Mac이나 다른 컴퓨터용 파일")).toBeVisible();
    fireEvent.change(screen.getByLabelText("칩 종류"), { target: { value: "x64" } });
    expect(screen.getByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", intel.url);
  });

  it("Windows 파일에 두 아키텍처가 있어도 연결된 앱의 칩에 맞는 파일을 바로 준다", async () => {
    const windowsArm: ConnectorRelease = { ...win, architecture: "arm64", url: "https://downloads.example/arm.exe" };
    setup("0.1.2", [windowsArm, win], "windows", "x64");
    expect(await screen.findByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", win.url);
    expect(screen.getByLabelText("칩 종류")).toHaveValue("x64");
    fireEvent.change(screen.getByLabelText("칩 종류"), { target: { value: "arm64" } });
    expect(screen.getByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", windowsArm.url);
  });

  it("칩을 알려주는 브라우저에서는 Intel Mac에 Intel 파일을 준다", async () => {
    Object.defineProperty(navigator, "userAgentData", { configurable: true, value: { getHighEntropyValues: vi.fn().mockResolvedValue({ architecture: "x86" }) } });
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
    setup(null, [arm, intel], "macos", null);
    await waitFor(() => expect(screen.getByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", intel.url));
  });

  it("조회 실패는 다시 시도 버튼 하나로 복구하고, 새 게시 파일은 창으로 돌아올 때 확인한다", async () => {
    const downloads = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ releases: [] }).mockResolvedValueOnce({ releases: [win] });
    context.use.mockReturnValue({ phase: "connected", api: { downloads }, device: { platform: "windows", bridgeVersion: "0.1.2", bridgeArchitecture: "x64" } });
    render(<BridgeUpdateInfo />);
    expect(await screen.findByText("최신 버전을 확인하지 못했어요")).toBeVisible();
    expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["다시 시도"]);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("연결된 PC의 최신 버전을 확인할 수 없어요")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", win.url);
    expect(downloads).toHaveBeenCalledTimes(3);
  });

  it("Apple Silicon 파일만 있어도 기본 파일과 칩 수정 방법을 제공한다", async () => {
    setup(null, [arm], "macos", null);
    expect(await screen.findByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", arm.url);
    expect(screen.getByText("Intel Mac이나 다른 컴퓨터용 파일")).toBeVisible();
    expect(screen.getByText(/칩을 확인하지 못해 Apple Silicon을 기본으로 선택/)).toBeVisible();
  });

  it("잘못된 다운로드 URL을 실행 링크로 만들지 않는다", async () => {
    setup("0.1.2", [{ ...win, url: "javascript:alert(1)" }]);
    expect(await screen.findByText("이 환경의 설치 파일을 준비 중이에요")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

it("다른 컴퓨터 파일을 골라도 연결된 PC의 버전 비교는 그대로이고 파일 요청 표시는 초기화한다", async () => {
  const other = { ...arm, version: "9.0.0" };
  setup("0.1.2", [win, other]);
  const link = await screen.findByRole("link", { name: "업데이트 받기" });
  link.addEventListener("click", event => event.preventDefault(), { once: true });
  fireEvent.click(link);
  expect(screen.getByText(/설치 파일을 요청했어요/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("운영체제"), { target: { value: "macos" } });
  expect(screen.getByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", other.url);
  expect(screen.getByText("최신 0.1.5")).toBeVisible();
  expect(screen.queryByText("최신 9.0.0")).toBeNull();
  expect(screen.queryByText(/설치 파일을 요청했어요/)).toBeNull();
  fireEvent.change(screen.getByLabelText("운영체제"), { target: { value: "windows" } });
  expect(screen.queryByText(/설치 파일을 요청했어요/)).toBeNull();
});

it("설치 앱의 칩이 없으면 수동 다운로드를 골라도 최신 여부를 단정하지 않는다", async () => {
  setup("0.1.5", [arm, intel], "macos", null);
  await screen.findByRole("link", { name: "업데이트 받기" });
  expect(screen.getByText("연결된 PC의 최신 버전을 확인할 수 없어요")).toBeVisible();
  expect(screen.queryByText("최신 버전이에요")).toBeNull();
  fireEvent.change(screen.getByLabelText("칩 종류"), { target: { value: "x64" } });
  expect(screen.getByText("연결된 PC의 최신 버전을 확인할 수 없어요")).toBeVisible();
});

it("현재 버전 앱에서도 다른 컴퓨터 설치 파일을 열 수 있다", async () => {
  setup("0.1.5", [win]);
  await screen.findByText("최신 버전이에요");
  fireEvent.click(screen.getByText("설치 파일 · 다른 컴퓨터에 설치"));
  expect(screen.getByRole("link", { name: "설치 파일 받기" })).toHaveAttribute("href", win.url);
});

it("게시 파일이 바뀌면 이전 파일에 대한 요청 안내를 지운다", async () => {
  const { downloads } = setup("0.1.2");
  const link = await screen.findByRole("link", { name: "업데이트 받기" });
  link.addEventListener("click", event => event.preventDefault(), { once: true });
  fireEvent.click(link);
  expect(screen.getByText(/설치 파일을 요청했어요/)).toBeVisible();
  downloads.mockResolvedValue({ releases: [{ ...win, version: "0.1.6", url: "https://downloads.example/0.1.6.exe" }] });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(screen.getByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", "https://downloads.example/0.1.6.exe"));
  expect(screen.queryByText(/설치 파일을 요청했어요/)).toBeNull();
});
