import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); context.use.mockReset(); });

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
    expect(screen.getByText(/다운로드한 설치 파일을 열면/)).toBeVisible();
    expect(screen.getByText("설치 0.1.2")).toBeVisible();
    expect(screen.queryByText("최신 버전이에요")).toBeNull();
    value.device.bridgeVersion = "0.1.5";
    rerender(<BridgeUpdateInfo />);
    expect(screen.getByText("최신 버전이에요")).toBeVisible();
    expect(screen.queryByRole("link", { name: "업데이트 받기" })).toBeNull();
  });

  it("설치 버전을 보고하지 않는 구 앱을 최신으로 표시하지 않는다", async () => {
    setup(null);
    expect(await screen.findByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", win.url);
    expect(screen.getByText("설치 버전 미확인")).toBeVisible();
    expect(screen.queryByText("최신 버전이에요")).toBeNull();
  });

  it.each(["0.1.5", "0.10.0"])("같거나 더 높은 설치 버전 %s에는 다운그레이드 링크를 제공하지 않는다", async version => {
    setup(version);
    expect(await screen.findByText(version === "0.1.5" ? "최신 버전이에요" : "설치 버전이 더 최신이에요")).toBeVisible();
    expect(screen.queryByRole("link", { name: "업데이트 받기" })).toBeNull();
  });

  it("실제 Mac 칩에 맞는 파일만 선택하고 칩 미확인은 직접 고른다", async () => {
    const arm = { ...win, platform: "macos" as const, architecture: "arm64", url: "https://downloads.example/arm.dmg" };
    const intel = { ...arm, architecture: "x64", url: "https://downloads.example/intel.dmg" };
    const { value, rerender } = setup("0.1.2", [arm, intel], "macos", "arm64");
    expect(await screen.findByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", arm.url);
    expect(screen.getByRole("link", { name: "업데이트 받기" })).toHaveAccessibleDescription("테스트 버전 · 게시자 서명 없음 · 처음 열 때 막히면 시스템 설정 > 개인정보 보호 및 보안에서 '그래도 열기'를 눌러 주세요.");
    value.device.bridgeArchitecture = null;
    rerender(<BridgeUpdateInfo />);
    expect(screen.queryByRole("link", { name: "업데이트 받기" })).toBeNull();
    fireEvent.change(screen.getByLabelText("업데이트할 칩 종류"), { target: { value: "x64" } });
    expect(screen.getByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", intel.url);
  });

  it("조회 실패·파일 부재를 분리하고 다시 확인해 새 게시 버전을 가져온다", async () => {
    const downloads = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ releases: [] }).mockResolvedValueOnce({ releases: [win] });
    context.use.mockReturnValue({ phase: "connected", api: { downloads }, device: { platform: "windows", bridgeVersion: "0.1.2", bridgeArchitecture: "x64" } });
    render(<BridgeUpdateInfo />);
    expect(await screen.findByText("최신 버전을 확인하지 못했어요")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
    expect(await screen.findByText("이 환경의 설치 파일을 준비 중이에요")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
    expect(await screen.findByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", win.url);
    expect(downloads).toHaveBeenCalledTimes(3);
  });

  it("Mac용 파일이 한 칩만 게시돼도 구 앱의 칩을 추정하지 않는다", async () => {
    const arm = { ...win, platform: "macos" as const, architecture: "arm64", url: "https://downloads.example/arm-only.dmg" };
    setup(null, [arm], "macos", null);
    const chip = await screen.findByLabelText("업데이트할 칩 종류");
    expect(chip).toHaveValue("");
    expect(screen.queryByRole("link", { name: "업데이트 받기" })).toBeNull();
    fireEvent.change(chip, { target: { value: "arm64" } });
    expect(screen.getByRole("link", { name: "업데이트 받기" })).toHaveAttribute("href", arm.url);
  });

  it("잘못된 다운로드 URL을 실행 링크로 만들지 않는다", async () => {
    setup("0.1.2", [{ ...win, url: "javascript:alert(1)" }]);
    expect(await screen.findByText("이 환경의 설치 파일을 준비 중이에요")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
