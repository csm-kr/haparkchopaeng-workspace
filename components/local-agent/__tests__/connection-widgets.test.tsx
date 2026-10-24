import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuotaBadge } from "../quota-badge";
import { ConnectionDialog } from "../connection-dialog";
import { InstallHelp } from "../install-help";
import { LocalAgentProvider } from "../provider";
import { localAgentApi, type ConnectorRelease } from "../client";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderInstallHelp(releases: ConnectorRelease[]) {
  const downloads = vi.fn().mockResolvedValue({ releases });
  return render(<LocalAgentProvider api={{ ...localAgentApi, downloads }}>
    <InstallHelp />
  </LocalAgentProvider>);
}

describe("설치 전에 확인하는 배포 상태", () => {
  const macNotice = "테스트 버전 · 게시자 서명 없음 · 처음 열 때 막히면 시스템 설정 > 개인정보 보호 및 보안에서 '그래도 열기'를 눌러 주세요.";

  it("감지한 운영체제의 파일을 버튼 하나로 바로 받고, 다른 선택지는 접어 둔다", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    renderInstallHelp([
      { platform: "windows", architecture: "x64", version: "0.1.0", url: "https://downloads.example/connector.exe" },
      { platform: "macos", architecture: "arm64", version: "0.1.0", url: "https://downloads.example/connector.dmg" },
    ]);
    const download = await screen.findByRole("link", { name: "AI 브릿지 받기" });
    expect(download).toBeVisible();
    expect(download).toHaveAttribute("href", "https://downloads.example/connector.exe");
    expect(screen.getByText("Windows용 · 0.1.0")).toBeVisible();
    expect(screen.getAllByRole("link")).toEqual([download]);
    expect(screen.getByRole("button", { name: "설치 후 연결하기" })).toBeEnabled();
    expect(screen.getByLabelText("운영체제")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "AI 브릿지 설치" })).toBeVisible();
    expect(screen.getByText(/설치 파일을 받는 것만으로 웹에 연결되지는 않아요/)).toBeVisible();
  });

  it("운영체제를 모르면 선택지를 펼쳐 두고 고른 뒤에 버튼을 준다", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; FreeBSD amd64)");
    renderInstallHelp([{ platform: "windows", version: "0.1.0", url: "https://downloads.example/connector.exe" }]);
    const platform = screen.getByLabelText("운영체제");
    expect(platform).toBeVisible();
    expect(screen.getByText("사용하는 PC의 운영체제를 선택해 주세요.")).toBeVisible();
    fireEvent.change(platform, { target: { value: "windows" } });
    expect(await screen.findByRole("link", { name: "AI 브릿지 받기" })).toHaveAttribute("href", "https://downloads.example/connector.exe");
  });

  it("미서명 Windows 파일은 다운로드 전에 테스트 버전과 게시자 확인 안내를 제공한다", async () => {
    renderInstallHelp([{
      platform: "windows", architecture: "x64", version: "0.1.0-preview",
      url: "https://downloads.example/connector-preview.exe", unsigned: true,
    }]);
    fireEvent.change(screen.getByLabelText("운영체제"), { target: { value: "windows" } });
    const download = await screen.findByRole("link", { name: "AI 브릿지 받기" });
    expect(screen.getByText("테스트 버전 · 게시자 서명 없음")).toBeVisible();
    expect(download).toHaveAccessibleDescription(/테스트 버전 · 게시자 서명 없음.*Windows.*게시자 확인/);
    expect(screen.queryByText(/그래도 열기/)).toBeNull();
    expect(download).toHaveAttribute("href", "https://downloads.example/connector-preview.exe");
  });

  it.each([undefined, false])("미서명 표시가 %s인 릴리스에는 미서명 안내를 붙이지 않는다", async (unsigned) => {
    renderInstallHelp([{
      platform: "windows", version: "0.1.0", url: "https://downloads.example/connector.exe", unsigned,
    }]);
    fireEvent.change(screen.getByLabelText("운영체제"), { target: { value: "windows" } });
    const download = await screen.findByRole("link", { name: "AI 브릿지 받기" });
    expect(download).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("테스트 버전 · 게시자 서명 없음")).toBeNull();
    expect(screen.queryByText(/게시자 확인/)).toBeNull();
    expect(screen.queryByText(/그래도 열기/)).toBeNull();
  });

  it("Windows 미서명 파일과 안내를 다른 운영체제에 표시하지 않는다", async () => {
    renderInstallHelp([{
      platform: "windows", version: "0.1.0-preview", url: "https://downloads.example/connector.exe", unsigned: true,
    }]);
    const platform = screen.getByLabelText("운영체제");
    fireEvent.change(platform, { target: { value: "windows" } });
    expect(await screen.findByRole("link", { name: "AI 브릿지 받기" })).toBeVisible();
    for (const value of ["macos", "linux"]) {
      fireEvent.change(platform, { target: { value } });
      expect(screen.queryByRole("link", { name: "AI 브릿지 받기" })).toBeNull();
      expect(screen.queryByText("테스트 버전 · 게시자 서명 없음")).toBeNull();
      expect(screen.queryByText(/게시자 확인/)).toBeNull();
      expect(screen.queryByText(/그래도 열기/)).toBeNull();
      expect(screen.getByRole("button", { name: "설치 파일 준비 중" })).toBeDisabled();
    }
  });

  it.each([undefined, false])("macOS는 칩을 모르면 Apple Silicon 파일을 주고, 다른 칩의 미서명 표시 %s는 경고하지 않는다", async (unsigned) => {
    renderInstallHelp([{
      platform: "macos", architecture: "arm64", version: "0.1.0-preview", url: "https://downloads.example/arm64.dmg", unsigned: true,
    }, {
      platform: "macos", architecture: "x64", version: "0.1.0", url: "https://downloads.example/x64.dmg", unsigned,
    }]);
    fireEvent.change(screen.getByLabelText("운영체제"), { target: { value: "macos" } });
    const download = await screen.findByRole("link", { name: "AI 브릿지 받기" });
    expect(download).toHaveAttribute("href", "https://downloads.example/arm64.dmg");
    expect(download).toHaveAccessibleDescription(macNotice);
    expect(screen.getByText("Mac · Apple Silicon용 · 0.1.0-preview")).toBeVisible();
    expect(screen.queryByText(/게시자 확인/)).toBeNull();
    fireEvent.change(screen.getByLabelText("칩 종류"), { target: { value: "x64" } });
    expect(screen.getByRole("link", { name: "AI 브릿지 받기" })).toHaveAttribute("href", "https://downloads.example/x64.dmg");
    expect(screen.getByRole("link", { name: "AI 브릿지 받기" })).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("테스트 버전 · 게시자 서명 없음")).toBeNull();
    expect(screen.queryByText(/그래도 열기/)).toBeNull();
  });

  it("Ubuntu 미서명 파일은 게시자 서명 제목만 안내한다", async () => {
    renderInstallHelp([{
      platform: "linux", architecture: "x64", version: "0.1.0-preview", url: "https://downloads.example/connector.deb", unsigned: true,
    }]);
    fireEvent.change(screen.getByLabelText("운영체제"), { target: { value: "linux" } });
    const download = await screen.findByRole("link", { name: "AI 브릿지 받기" });
    expect(download).toHaveAccessibleDescription("테스트 버전 · 게시자 서명 없음");
    expect(screen.queryByText(/게시자 확인/)).toBeNull();
    expect(screen.queryByText(/그래도 열기/)).toBeNull();
  });
});

describe("작은 사용량 표시", () => {
  const windows = [
    { id: "5h", label: "5시간 구독 한도", remainingPercent: 62, resetsAt: "2026-10-17T09:00:00.000Z", observedAt: "2026-10-17T07:00:00.000Z", freshness: "fresh" as const },
    { id: "7d", label: "7일 한도", remainingPercent: null, resetsAt: null, observedAt: null, freshness: "unknown" as const },
  ];

  function tap(button: HTMLElement) {
    fireEvent.pointerDown(button, { pointerType: "touch" });
    act(() => { button.focus(); });
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button, { detail: 1 });
  }

  it("20px 링만 표시하고 상세는 호버·포커스할 때 보여 준다", () => {
    render(<QuotaBadge windows={windows} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getAllByTestId("usage-ring")).toHaveLength(2);
    expect(screen.getAllByTestId("usage-ring")[0]).toHaveAttribute("width", "20");
    const button = screen.getByRole("button", { name: "사용량 상세" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("62% 남음");
    expect(screen.getByRole("tooltip")).toHaveTextContent("정보를 제공하지 않아요");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("간결한 표시도 독립된 이름으로 키보드와 터치에서 실제 한도를 확인한다", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<QuotaBadge windows={[windows[0]]} compact label="현재 모델 사용량 상세" />);
    const button = screen.getByRole("button", { name: "현재 모델 사용량 상세" });
    expect(button).not.toHaveTextContent("5h");
    expect(screen.getByTestId("usage-ring")).toHaveAttribute("width", "20");
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("62% 남음");
    expect(screen.getByRole("tooltip")).toHaveTextContent("초기화");
    expect(screen.getByRole("tooltip")).toHaveTextContent("확인");
    fireEvent.blur(button);
    tap(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("정확한 잔여 토큰 수를 의미하지 않아요");
    tap(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("0%·미제공·이전 관측값을 구분하고 잔여 토큰으로 표현하지 않는다", () => {
    render(<QuotaBadge windows={[
      { ...windows[0], remainingPercent: 0, freshness: "stale" },
      windows[1],
    ]} />);
    fireEvent.focus(screen.getByRole("button", { name: "사용량 상세" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("0% 남음");
    expect(screen.getByRole("tooltip")).toHaveTextContent("이전 확인값");
    expect(screen.getByRole("tooltip")).toHaveTextContent("정확한 잔여 토큰 수를 의미하지 않아요");
    expect(screen.getAllByTestId("usage-ring")[1]).toHaveAttribute("data-state", "unknown");
    expect(screen.getAllByTestId("usage-ring")[0]).toHaveAttribute("data-state", "stale");
  });

  it("첫 터치의 pointerdown·focus·click 뒤에도 상세가 열리고 두 번째 터치는 닫는다", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<QuotaBadge windows={windows} />);
    const button = screen.getByRole("button", { name: "사용량 상세" });
    tap(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(button).toHaveFocus();
    tap(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("호버 없는 환경의 키보드 focus·Enter는 열린 상세를 닫지 않고 Escape 뒤에도 다시 연다", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<QuotaBadge windows={windows} />);
    const button = screen.getByRole("button", { name: "사용량 상세" });
    act(() => { button.focus(); });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button, { detail: 0 });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button, { detail: 0 });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("터치 상세는 외부 포커스·Escape·외부 누르기로 닫히며 취소된 포인터 뒤에도 키보드로 다시 연다", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<><QuotaBadge windows={windows} compact /><button type="button">다른 항목</button></>);
    const button = screen.getByRole("button", { name: "사용량 상세" });
    tap(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => { screen.getByRole("button", { name: "다른 항목" }).focus(); });
    expect(screen.queryByRole("tooltip")).toBeNull();
    tap(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.pointerCancel(button, { pointerType: "touch" });
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button, { detail: 0 });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "다른 항목" }), { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("호버 중 새 사용량이 동기화되어도 상세를 유지한다", () => {
    const { rerender } = render(<QuotaBadge windows={windows} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "사용량 상세" }));
    rerender(<QuotaBadge windows={[{ ...windows[0], remainingPercent: 61 }, windows[1]]} />);
    expect(screen.getByRole("tooltip")).toHaveTextContent("61% 남음");
  });
});

describe("연결 모달 접근성", () => {
  it("열리면 포커스를 옮기고 Tab을 가두며 Escape 후 원래 버튼으로 돌아온다", () => {
    const close = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "AI 연결";
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<ConnectionDialog title="AI 연결" onClose={close}>
      <button type="button">AI 브릿지 열기</button>
      <button type="button">마지막 동작</button>
    </ConnectionDialog>);
    const dialog = screen.getByRole("dialog", { name: "AI 연결" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    const last = screen.getByRole("button", { name: "마지막 동작" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(screen.getByRole("button", { name: "연결창 닫기" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("취소처럼 포커스된 동작이 사라지면 연결창 안으로 포커스를 복구한다", () => {
    const { rerender } = render(<ConnectionDialog title="AI 연결" onClose={vi.fn()}>
      <button type="button">연결 취소</button>
    </ConnectionDialog>);
    screen.getByRole("button", { name: "연결 취소" }).focus();
    rerender(<ConnectionDialog title="AI 연결" onClose={vi.fn()}><p>연결을 취소했어요</p></ConnectionDialog>);
    expect(screen.getByRole("button", { name: "연결창 닫기" })).toHaveFocus();
  });

  it("포커스가 문서로 빠져도 Escape와 Tab이 연결창에서 처리된다", () => {
    const close = vi.fn();
    render(<ConnectionDialog title="AI 연결" onClose={close}><p>대기 중</p></ConnectionDialog>);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(screen.getByRole("button", { name: "연결창 닫기" })).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
