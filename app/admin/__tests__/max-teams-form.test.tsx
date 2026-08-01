import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// 상한 조절 폼: 실패는 토스트가 아니라 인라인(R30). 현재 값이 입력에 프리필된다.

const { actionMock } = vi.hoisted(() => ({ actionMock: vi.fn() }));
vi.mock("../actions", () => ({ setMaxTeamsAction: actionMock }));

const { MaxTeamsForm } = await import("../max-teams-form");

beforeEach(() => {
  vi.clearAllMocks();
  actionMock.mockResolvedValue({ ok: true, value: 5 });
});

it("현재 상한이 입력에 프리필된다", () => {
  render(<MaxTeamsForm current={3} teamCount={2} />);
  expect(screen.getByLabelText(/전역 팀 상한/)).toHaveValue(3);
});

it("저장하면 입력값으로 액션을 호출한다", async () => {
  render(<MaxTeamsForm current={3} teamCount={2} />);
  fireEvent.change(screen.getByLabelText(/전역 팀 상한/), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(actionMock).toHaveBeenCalledWith({ value: 5 }));
});

it("성공하면 인라인 성공 메시지를 보여준다", async () => {
  render(<MaxTeamsForm current={3} teamCount={2} />);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByText(/저장했어요/)).toBeInTheDocument();
});

it("실패하면 서버 메시지를 인라인으로 보여준다(토스트 아님)", async () => {
  actionMock.mockResolvedValue({
    ok: false,
    code: "BELOW_CURRENT",
    message: "이미 만들어진 팀이 3개예요. 그보다 작게는 못 줄여요.",
  });
  render(<MaxTeamsForm current={3} teamCount={3} />);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByText(/그보다 작게는 못 줄여요/)).toBeInTheDocument();
});

it("현재 팀 수를 안내로 보여준다", () => {
  render(<MaxTeamsForm current={3} teamCount={2} />);
  expect(screen.getByText(/현재 2개/)).toBeInTheDocument();
});
