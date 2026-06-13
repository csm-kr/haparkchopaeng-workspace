import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsView } from "../settings-view";
import { ThemeProvider } from "@/components/providers";
import type { ProfileView } from "../types";

// 설정 섬 — RTL. 프로필 필드 렌더·수정 검증, 테마 토글이 data-theme를 전환,
// 알림 토글 동작을 확인한다. 테마는 ThemeProvider 안에서만 동작한다(useTheme).

const profile: ProfileView = {
  id: "ha",
  name: "하수현",
  handle: "@hajieun",
  email: "ha@habakjopaeng.team",
  role: "관리자",
  status: "MoE 라우팅 읽는 중",
  color: "var(--m-ha)",
  initial: "하",
};

function renderSettings() {
  return render(
    <ThemeProvider initialTheme="light">
      <SettingsView profile={profile} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = "light";
  vi.restoreAllMocks();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("SettingsView", () => {
  it("프로필 필드를 채워 렌더하고 이메일·역할은 읽기 전용으로 보인다", () => {
    renderSettings();
    expect((screen.getByLabelText("이름") as HTMLInputElement).value).toBe("하수현");
    expect((screen.getByLabelText("핸들") as HTMLInputElement).value).toBe("@hajieun");
    expect((screen.getByLabelText("상태 메시지") as HTMLInputElement).value).toBe(
      "MoE 라우팅 읽는 중",
    );
    // 이메일·역할은 읽기 전용 표시(편집 입력이 아님).
    expect(screen.getAllByText("ha@habakjopaeng.team").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("관리자").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText("이메일")).not.toBeInTheDocument();
  });

  it("이름이 비면 인라인 검증으로 막고 PATCH를 보내지 않는다(R30)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderSettings();

    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "  " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });

    expect(screen.getByText("이름을 입력해주세요.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("저장하면 PATCH /api/me로 보내고(세션 기반) 성공 토스트를 보인다", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: "ha" } }), { status: 200 }),
      );
    renderSettings();

    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "하수현2" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init?.method).toBe("PATCH");
    const sent = JSON.parse(String(init?.body));
    expect(sent).toEqual({
      name: "하수현2",
      handle: "@hajieun",
      status: "MoE 라우팅 읽는 중",
    });
    // id를 보내지 않는다 — 서버가 세션에서 취한다(R3).
    expect(sent).not.toHaveProperty("id");
    expect(await screen.findByText("저장했어요")).toBeInTheDocument();
  });

  it("테마 버튼을 누르면 <html data-theme>가 전환된다(R20)", () => {
    renderSettings();
    const group = screen.getByRole("group", { name: "테마 선택" });
    const dark = within(group).getByRole("button", { name: /다크/ });

    fireEvent.click(dark);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(dark).toHaveAttribute("aria-pressed", "true");

    const light = within(group).getByRole("button", { name: /라이트/ });
    fireEvent.click(light);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("알림 토글이 상태를 바꾸고 로컬에 저장한다(인앱 기본, 외부 채널 없음)", () => {
    renderSettings();
    const liveSwitch = screen.getByRole("switch", { name: "라이브 시작 알림" });
    expect(liveSwitch).toHaveAttribute("aria-checked", "true");

    fireEvent.click(liveSwitch);
    expect(liveSwitch).toHaveAttribute("aria-checked", "false");

    const stored = JSON.parse(window.localStorage.getItem("hapark_notif") ?? "{}");
    expect(stored.live).toBe(false);
  });

  it("법적 링크를 누르면 약관 시트가 열린다", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "이용약관" }));
    expect(screen.getByRole("dialog", { name: "이용약관" })).toBeInTheDocument();
  });
});
