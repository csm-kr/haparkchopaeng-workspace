import { describe, expect, it } from "vitest";
import { bridgeReleaseFor, compareBridgeVersions, safeBridgeDownloadUrl } from "../bridge-release";

describe("설치 앱과 게시 버전의 비교", () => {
  it.each([
    ["0.1.2", "0.1.5", -1], ["0.10.0", "0.9.9", 1], ["1.0.0", "1.0.0", 0],
    ["1.0.0-preview.9", "1.0.0-preview.10", -1], ["1.0.0-preview.1", "1.0.0", -1],
    ["1.0.0+build.1", "1.0.0+build.2", 0], ["1.0.0-alpha", "1.0.0-beta", -1],
  ])("%s 대 %s", (installed, published, result) => {
    expect(compareBridgeVersions(installed, published)).toBe(result);
  });

  it.each([null, undefined, "", "0.1", "v0.1.2", "1.0.0-01", "01.0.0", "not-a-version"])("미제공·잘못된 버전 %s를 최신으로 추정하지 않는다", installed => {
    expect(compareBridgeVersions(installed, "0.1.5")).toBeNull();
  });

  it("알려진 칩에 호환되는 게시 파일 중 숫자 기준 최신을 고르고 다른 칩의 최신은 섞지 않는다", () => {
    const arm = { platform: "macos" as const, architecture: "arm64", version: "0.10.0", url: "https://downloads.example/arm.dmg" };
    const oldArm = { ...arm, version: "0.9.0", url: "https://downloads.example/old.dmg" };
    const intel = { ...arm, architecture: "x64", version: "1.0.0", url: "https://downloads.example/intel.dmg" };
    expect(bridgeReleaseFor([oldArm, intel, arm], "macos", "arm64")).toEqual(arm);
    expect(bridgeReleaseFor([oldArm, intel, arm], "macos", "x64")).toEqual(intel);
    expect(bridgeReleaseFor([oldArm, intel, arm], "macos", undefined)).toBeNull();
    expect(bridgeReleaseFor([arm], "macos", undefined)).toBeNull();
    expect(bridgeReleaseFor([arm], "windows", "x64")).toBeNull();
  });

  it("맞지 않는 설치 칩을 자동으로 선택하지 않는다", () => {
    const windows = { platform: "windows" as const, architecture: "x64", version: "0.1.5", url: "https://downloads.example/win.exe" };
    expect(bridgeReleaseFor([windows], "windows", "arm64")).toBeNull();
    expect(bridgeReleaseFor([windows], "windows", undefined)).toEqual(windows);
    expect(bridgeReleaseFor([{ ...windows, version: "invalid" }], "windows", undefined)).toBeNull();
  });

  it.each(["javascript:alert(1)", "//foreign.example/file.exe", "https://user:pass@example.com/file.exe", "https://example.com/a\\b", "https://example.com/%0aevil", "file:///tmp/app", "relative.exe"])("안전하지 않은 링크 %s를 업데이트 버튼에 넣지 않는다", value => {
    expect(safeBridgeDownloadUrl(value, "https://hapark.vercel.app")).toBeNull();
  });

  it("서버가 게시한 HTTPS 파일과 자체 절대 경로만 허용한다", () => {
    expect(safeBridgeDownloadUrl("https://downloads.example/app.exe", "https://hapark.vercel.app")).toBe("https://downloads.example/app.exe");
    expect(safeBridgeDownloadUrl("/downloads/app.exe", "http://localhost:3000")).toBe("http://localhost:3000/downloads/app.exe");
  });
});
