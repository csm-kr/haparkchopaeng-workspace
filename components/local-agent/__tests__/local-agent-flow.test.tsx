import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAgentAttemptCreated, LocalAgentDeviceView, LocalAgentJobView, LocalAgentStatus } from "@/types/local-agent";
import { LocalAgentApiError, type LocalAgentApi } from "../client";
import { LocalAgentProvider } from "../provider";
import { LocalAgentEntry } from "../entry";
import { LocalAgentSettingsCard } from "../settings-card";

const device: LocalAgentDeviceView = {
  id: "device-a", name: "연구실 PC", platform: "windows", online: true,
  lastSeenAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 45000).toISOString(),
  providers: [{ provider: "codex", status: "ready", models: [{ id: "gpt-test", name: "실제 감지된 모델" }], quota: null, observedAt: new Date().toISOString() }],
};
const idle: LocalAgentStatus = { devices: [], device: null, leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 };
const created: LocalAgentAttemptCreated = {
  id: "attempt-a", version: 1, status: "awaiting_app", expiresAt: new Date(Date.now() + 300000).toISOString(),
  code: "048217", device: null, launchToken: "launch-opaque", deepLink: "hapark-connect://connect?attemptId=attempt-a&launchToken=launch-opaque",
};
function makeApi(): LocalAgentApi {
  return {
    status: vi.fn().mockResolvedValue(idle),
    createAttempt: vi.fn().mockResolvedValue(created),
    getAttempt: vi.fn().mockResolvedValue({ ...created, status: "awaiting_code", version: 2 }),
    cancelAttempt: vi.fn().mockResolvedValue({ cancelled: true }),
    heartbeat: vi.fn().mockResolvedValue({ leaseExpiresAt: new Date(Date.now() + 45000).toISOString() }),
    disconnect: vi.fn().mockResolvedValue({ revoked: true }),
    downloads: vi.fn().mockResolvedValue({ releases: [] }),
    createJob: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn(),
  };
}
function View({ api, teamId = "team-a", launch = vi.fn(() => true) }: { api: LocalAgentApi; teamId?: string; launch?: (url: string) => boolean }) {
  return <LocalAgentProvider teamId={teamId} api={api} launchConnector={launch}>
    <LocalAgentEntry />
    <LocalAgentSettingsCard papers={[{ id: "paper-a", title: "우리 논문" }]} />
  </LocalAgentProvider>;
}
beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); window.history.replaceState(null, "", "/profile"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("로컬 AI 연결 흐름", () => {
  it("앱 응답 전에는 번호를 숨기고 ACK 뒤에만 6자리와 남은 시간을 보여 준다", async () => {
    vi.useFakeTimers();
    const api = makeApi();
    const launch = vi.fn(() => true);
    vi.mocked(api.getAttempt).mockResolvedValue({ ...created, status: "awaiting_code", version: 2,
      expiresAt: new Date(Date.now() + 301000).toISOString() });
    await act(async () => { render(<View api={api} launch={launch} />); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "AI 연결" })[0]); });
    const dialog = screen.getByRole("dialog", { name: "AI 연결" });
    expect(launch).toHaveBeenCalledWith(created.deepLink);
    expect(within(dialog).queryByLabelText("연결 확인 번호")).toBeNull();
    expect(within(dialog).queryByRole("timer")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(within(dialog).getByLabelText("연결 확인 번호")).toHaveTextContent("048 217");
    expect(within(dialog).getByRole("timer")).toHaveTextContent("05:00 남음");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).getByRole("heading", { name: "웹의 번호를 AI 브릿지에 입력해 주세요" })).toBeInTheDocument();
    expect(api.createAttempt).toHaveBeenCalledTimes(1);
  });

  it("앱이 응답하지 않으면 설치 안내에서도 확인 번호를 표시하지 않는다", async () => {
    vi.useFakeTimers();
    const api = makeApi();
    vi.mocked(api.getAttempt).mockResolvedValue(created);
    await act(async () => { render(<View api={api} />); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "AI 연결" })[0]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByLabelText("운영체제")).toBeInTheDocument();
    expect(screen.queryByLabelText("연결 확인 번호")).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("서버 만료 시각까지 시간을 줄이고 네트워크 응답이 없어도 만료 번호를 숨긴다", async () => {
    vi.useFakeTimers();
    const api = makeApi();
    let reply!: (value: typeof created) => void;
    const expiresAt = new Date(Date.now() + 301000).toISOString();
    vi.mocked(api.getAttempt)
      .mockResolvedValueOnce({ ...created, version: 2, status: "awaiting_code", expiresAt })
      .mockImplementation(() => new Promise(done => { reply = done; }));
    await act(async () => { render(<View api={api} />); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "AI 연결" })[0]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("timer")).toHaveTextContent("05:00 남음");
    await act(async () => { await vi.advanceTimersByTimeAsync(61000); });
    expect(screen.getByRole("timer")).toHaveTextContent("03:59 남음");
    expect(screen.getByRole("progressbar", { name: "연결 가능 시간" })).toHaveAttribute("aria-valuenow", "239");
    // A throttled background tab must recompute from wall time on return.
    vi.setSystemTime(new Date(expiresAt));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(screen.queryByLabelText("연결 확인 번호")).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByRole("button", { name: "새 번호로 연결" })).toBeInTheDocument();
    await act(async () => { reply({ ...created, version: 3, status: "connected", device }); });
    expect(screen.queryByRole("button", { name: "내 PC 연결됨" })).toBeNull();
  });

  it("설치 파일이 있는 macOS는 Apple Silicon 파일을 기본으로 주고 Intel은 직접 고른다", async () => {
    const api = makeApi();
    vi.mocked(api.downloads).mockResolvedValue({ releases: [
      { platform: "macos", architecture: "arm64", version: "0.1.0", url: "https://downloads.example/arm64.dmg" },
      { platform: "macos", architecture: "x64", version: "0.1.0", url: "https://downloads.example/x64.dmg" },
    ] });
    render(<View api={api} />);
    await screen.findAllByRole("button", { name: "AI 연결" });
    fireEvent.click(screen.getAllByRole("button", { name: "AI 연결" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "AI 브릿지가 열리지 않아요" }));
    await waitFor(() => expect(api.downloads).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("운영체제"), { target: { value: "macos" } });
    expect(await screen.findByRole("link", { name: "AI 브릿지 받기" })).toHaveAttribute("href", "https://downloads.example/arm64.dmg");
    fireEvent.change(screen.getByLabelText("칩 종류"), { target: { value: "x64" } });
    expect(screen.getByRole("link", { name: "AI 브릿지 받기" })).toHaveAttribute("href", "https://downloads.example/x64.dmg");
  });

  it("취소 뒤 도착한 생성 응답은 실행·연결을 되살리지 않는다", async () => {
    const api = makeApi();
    let resolve!: (value: LocalAgentAttemptCreated) => void;
    vi.mocked(api.createAttempt).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const launch = vi.fn(() => true);
    render(<View api={api} launch={launch} />);
    await screen.findAllByRole("button", { name: "AI 연결" });
    fireEvent.click(screen.getAllByRole("button", { name: "AI 연결" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "연결 취소" }));
    await act(async () => { resolve(created); });
    expect(launch).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("연결 확인 번호")).toBeNull();
    expect(api.cancelAttempt).toHaveBeenCalledWith("attempt-a");
  });

  it("다른 PC 목록만으로 이 PC가 연결됐다고 표시하지 않는다", async () => {
    const api = makeApi();
    vi.mocked(api.status).mockResolvedValue({ ...idle, devices: [device] });
    render(<View api={api} />);
    await screen.findAllByRole("button", { name: "AI 연결" });
    expect(screen.queryByRole("button", { name: "내 PC 연결됨" })).toBeNull();
    expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeDisabled();
    expect(api.heartbeat).not.toHaveBeenCalled();
  });

  it("연결되어도 모델은 무선택이며 실제 카탈로그에서 고른 뒤 질문할 수 있다", async () => {
    const api = makeApi();
    vi.mocked(api.status).mockResolvedValue({ ...idle, device, devices: [device] });
    render(<View api={api} />);
    const select = await screen.findByRole("button", { name: "모델을 선택하세요" });
    await waitFor(() => expect(select).toBeEnabled());
    expect(screen.getByRole("button", { name: "질문 보내기" })).toBeDisabled();
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: /실제 감지된 모델/ }));
    fireEvent.change(screen.getByLabelText("질문할 논문"), { target: { value: "paper-a" } });
    fireEvent.change(screen.getByLabelText("논문 질문"), { target: { value: "핵심 기여가 무엇인가요?" } });
    expect(screen.getByRole("button", { name: "질문 보내기" })).toBeEnabled();
  });

  it.each<{ name: string; status: "failed" | "cancelled"; error: string | null; expected: string }>([
    { name: "구독 한도 초과", status: "failed", error: "구독 사용 한도에 도달했어요.", expected: "구독 사용 한도에 도달했어요." },
    { name: "CLI 로그인 필요", status: "failed", error: "PC에서 해당 CLI에 다시 로그인해 주세요.", expected: "PC에서 해당 CLI에 다시 로그인해 주세요." },
    { name: "공급자 상태 변경 취소", status: "cancelled", error: "연결한 AI의 로그인과 사용 가능 상태를 확인해주세요.", expected: "연결한 AI의 로그인과 사용 가능 상태를 확인해주세요." },
    { name: "안내 없는 실패", status: "failed", error: null, expected: "답변을 완료하지 못했어요. 연결과 공급자 상태를 확인해 주세요." },
    { name: "안내 없는 취소", status: "cancelled", error: null, expected: "질문을 취소했어요" },
  ])("비동기 질문 결과의 $name 상태를 답변 안에 안내한다", async ({ status, error, expected }) => {
    const api = makeApi();
    const queued: LocalAgentJobView = {
      id: "job-a", version: 1, paperId: "paper-a", provider: "codex", model: "gpt-test", prompt: "핵심 기여가 무엇인가요?",
      status: "queued", response: "", error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    vi.mocked(api.status).mockResolvedValue({ ...idle, device, devices: [device] });
    vi.mocked(api.createJob).mockResolvedValue(queued);
    vi.mocked(api.getJob).mockResolvedValue({ ...queued, version: 2, status, error });
    render(<View api={api} />);
    const picker = screen.getByRole("button", { name: "모델을 선택하세요" });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: /실제 감지된 모델/ }));
    fireEvent.change(screen.getByLabelText("질문할 논문"), { target: { value: "paper-a" } });
    fireEvent.change(screen.getByLabelText("논문 질문"), { target: { value: queued.prompt } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "질문 보내기" })); });
    expect(within(screen.getByRole("region", { name: "AI 답변" })).getByRole("status")).toHaveTextContent("이 PC의 AI가 질문을 기다리고 있어요");
    await waitFor(() => expect(within(screen.getByRole("region", { name: "AI 답변" })).getByRole("status")).toHaveTextContent(expected), { timeout: 3000 });
    expect(api.getJob).toHaveBeenCalledWith("job-a");
  });

  it("팀 변경은 모델·번호·사용량과 이전 비동기 응답을 지운다", async () => {
    const api = makeApi();
    let resolve!: (value: LocalAgentAttemptCreated) => void;
    vi.mocked(api.createAttempt).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const launch = vi.fn(() => true);
    const { rerender } = render(<View api={api} teamId="team-a" launch={launch} />);
    await screen.findAllByRole("button", { name: "AI 연결" });
    fireEvent.click(screen.getAllByRole("button", { name: "AI 연결" })[0]);
    rerender(<View api={api} teamId="team-b" launch={launch} />);
    await act(async () => { resolve(created); });
    expect(launch).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("연결 확인 번호")).toBeNull();
    expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeDisabled();
  });

  it("인증이 사라지면 이전 카탈로그를 숨기고 로그인 안내를 보여 준다", async () => {
    const api = makeApi();
    vi.mocked(api.status).mockRejectedValue(new LocalAgentApiError(401, "UNAUTHORIZED"));
    render(<View api={api} />);
    expect(await screen.findByText(/다시 로그인해 주세요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeDisabled();
    expect(screen.queryByText("실제 감지된 모델")).toBeNull();
  });

  it("응답 대기만으로 파일을 자동 다운로드하지 않고 미배포 파일을 비활성화한다", async () => {
    const api = makeApi();
    render(<View api={api} />);
    await screen.findAllByRole("button", { name: "AI 연결" });
    fireEvent.click(screen.getAllByRole("button", { name: "AI 연결" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "AI 브릿지가 열리지 않아요" }));
    expect(await screen.findByRole("button", { name: /설치 파일 준비 중/ })).toBeDisabled();
    expect(screen.getByText(/처음이라면 AI 브릿지를 설치해 주세요/)).toBeInTheDocument();
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it("모델 검색은 키보드로 이동하고 Escape로 닫힌 뒤 선택 버튼에 돌아온다", async () => {
    const api = makeApi();
    vi.mocked(api.status).mockResolvedValue({ ...idle, device, devices: [device] });
    render(<View api={api} />);
    const picker = screen.getByRole("button", { name: "모델을 선택하세요" });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.click(picker);
    const search = screen.getByRole("searchbox", { name: "모델 검색" });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const option = screen.getByRole("option", { name: /실제 감지된 모델/ });
    expect(option).toHaveFocus();
    fireEvent.keyDown(option, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(picker).toHaveFocus();
  });

  it("취소 뒤 도착한 연결 완료 ACK는 연결 권한을 되살리지 않는다", async () => {
    vi.useFakeTimers();
    const api = makeApi();
    let resolve!: (value: typeof created) => void;
    vi.mocked(api.getAttempt).mockImplementation(() => new Promise((done) => { resolve = done; }));
    await act(async () => { render(<View api={api} />); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "AI 연결" })[0]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    fireEvent.click(screen.getByRole("button", { name: "연결 취소" }));
    await act(async () => { resolve({ ...created, version: 3, status: "connected", device }); });
    expect(screen.queryByRole("button", { name: "내 PC 연결됨" })).toBeNull();
    expect(screen.queryByLabelText("연결 확인 번호")).toBeNull();
    expect(api.heartbeat).not.toHaveBeenCalled();
  });

  it("이전 버전 ACK를 무시하고 새 연결 완료만 반영한다", async () => {
    vi.useFakeTimers();
    const api = makeApi();
    vi.mocked(api.getAttempt)
      .mockResolvedValueOnce({ ...created, version: 2, status: "awaiting_code" })
      .mockResolvedValueOnce({ ...created, version: 1, status: "connected", device })
      .mockResolvedValueOnce({ ...created, version: 3, status: "connected", device });
    vi.mocked(api.status).mockResolvedValueOnce(idle).mockResolvedValue({ ...idle, device, devices: [device] });
    await act(async () => { render(<View api={api} />); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "AI 연결" })[0]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.queryByRole("button", { name: "내 PC 연결됨" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("button", { name: "내 PC 연결됨" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem("hapark.local-agent.device:team-a")).toBe("device-a");
    expect(window.sessionStorage.getItem("hapark.local-agent.attempt:team-a")).toBeNull();
    expect(JSON.stringify(window.sessionStorage)).not.toContain("launch-opaque");
    expect(JSON.stringify(window.sessionStorage)).not.toContain("048217");
  });

  it("공급자 로그아웃이 동기화되면 이전 모델 선택과 사용량을 제거한다", async () => {
    const api = makeApi();
    vi.mocked(api.status).mockResolvedValue({ ...idle, device, devices: [device] });
    render(<View api={api} />);
    const picker = screen.getByRole("button", { name: "모델을 선택하세요" });
    await waitFor(() => expect(picker).toBeEnabled());
    await waitFor(() => expect(api.heartbeat).toHaveBeenCalled());
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: /실제 감지된 모델/ }));
    const loggedOut = { ...device, providers: [{ ...device.providers[0], status: "login_required" as const, models: [], quota: null }] };
    vi.mocked(api.status).mockResolvedValue({ ...idle, device: loggedOut, devices: [loggedOut] });
    fireEvent.click(screen.getByRole("button", { name: "상태 다시 확인" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeDisabled());
    expect(screen.queryByRole("button", { name: /실제 감지된 모델/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "사용량 상세" })).toBeNull();
  });

  it("웹 heartbeat 인증 만료는 모델·이전 기기 정보·실행 허가를 지운다", async () => {
    vi.useFakeTimers();
    const api = makeApi();
    vi.mocked(api.status).mockResolvedValue({ ...idle, device, devices: [device] });
    await act(async () => { render(<View api={api} />); });
    expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeEnabled();
    expect(api.heartbeat).toHaveBeenCalledTimes(1);
    vi.mocked(api.heartbeat).mockRejectedValue(new LocalAgentApiError(401, "SESSION_EXPIRED"));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByText(/다시 로그인해 주세요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "모델을 선택하세요" })).toBeDisabled();
    expect(screen.queryByText("연구실 PC")).toBeNull();
    expect(window.sessionStorage.getItem("hapark.local-agent.device:team-a")).toBeNull();
  });

  it("설치 후 복귀 query는 초기 권한 확인 후 한 번만 연결하고 제거한다", async () => {
    const api = makeApi();
    window.history.replaceState(null, "", "/profile?localAgentResume=1&keep=1#ai");
    const launch = vi.fn(() => false);
    render(<React.StrictMode><View api={api} launch={launch} /></React.StrictMode>);
    await waitFor(() => expect(api.createAttempt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#ai");
    expect(await screen.findByRole("link", { name: "AI 브릿지 다시 열기" })).toHaveAttribute("href", created.deepLink);
  });

  it("같은 이벤트 배치에서 질문을 두 번 제출해도 한 번만 적재한다", async () => {
    const api = makeApi();
    vi.mocked(api.status).mockResolvedValue({ ...idle, device, devices: [device] });
    vi.mocked(api.createJob).mockImplementation(() => new Promise(() => {}));
    render(<View api={api} />);
    const picker = screen.getByRole("button", { name: "모델을 선택하세요" });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: /실제 감지된 모델/ }));
    fireEvent.change(screen.getByLabelText("질문할 논문"), { target: { value: "paper-a" } });
    fireEvent.change(screen.getByLabelText("논문 질문"), { target: { value: "논문의 근거는?" } });
    const form = screen.getByRole("button", { name: "질문 보내기" }).closest("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(api.createJob).toHaveBeenCalledTimes(1);
  });

  it("응답을 받지 못한 같은 질문의 재시도는 같은 요청 번호를 사용한다", async () => {
    const api = makeApi();
    vi.mocked(api.status).mockResolvedValue({ ...idle, device, devices: [device] });
    vi.mocked(api.createJob).mockRejectedValue(new Error("network response lost"));
    render(<View api={api} />);
    const picker = screen.getByRole("button", { name: "모델을 선택하세요" });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: /실제 감지된 모델/ }));
    fireEvent.change(screen.getByLabelText("질문할 논문"), { target: { value: "paper-a" } });
    fireEvent.change(screen.getByLabelText("논문 질문"), { target: { value: "논문의 근거는?" } });
    fireEvent.click(screen.getByRole("button", { name: "질문 보내기" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "질문 보내기" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "질문 보내기" }));
    await waitFor(() => expect(api.createJob).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(api.createJob).mock.calls.map(([input]) => input);
    expect(first.requestId).toBe(second.requestId);
    expect(first).not.toHaveProperty("memberId");
    expect(first).not.toHaveProperty("teamId");
    await waitFor(() => expect(screen.getByRole("button", { name: "질문 보내기" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("논문 질문"), { target: { value: "다른 질문" } });
    fireEvent.click(screen.getByRole("button", { name: "질문 보내기" }));
    await waitFor(() => expect(api.createJob).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.createJob).mock.calls[2][0].requestId).not.toBe(first.requestId);
  });
});
