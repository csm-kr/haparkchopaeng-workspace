import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DeleteTeamSection } from "../delete-team-section";

// 팀 삭제 섹션 — 삭제 가능 팀 나열 + 이름 타이핑 확인(R27) → deleteTeamAction 호출.
// 가시화는 서버가 계산해 props로 준다(관리자=전체 / owner=내 팀). 여기선 확인 게이트·액션 호출을 본다.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const { deleteTeamActionMock } = vi.hoisted(() => ({ deleteTeamActionMock: vi.fn() }));
vi.mock("../actions", () => ({ deleteTeamAction: deleteTeamActionMock }));

const TEAMS = [
  { slug: "alpha", name: "알파" },
  { slug: "beta", name: "베타" },
];

beforeEach(() => {
  vi.clearAllMocks();
  deleteTeamActionMock.mockResolvedValue({ ok: true });
});

describe("DeleteTeamSection", () => {
  it("팀이 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<DeleteTeamSection teams={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("삭제 가능 팀을 행으로 + 각 행에 삭제 버튼", () => {
    render(<DeleteTeamSection teams={TEAMS} />);
    expect(screen.getByRole("button", { name: "알파 삭제" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "베타 삭제" })).toBeInTheDocument();
  });

  it("이름을 정확히 입력해야 확정 버튼이 활성화되고 액션을 호출한다(R27)", async () => {
    render(<DeleteTeamSection teams={TEAMS} />);
    fireEvent.click(screen.getByRole("button", { name: "알파 삭제" }));

    const dialog = screen.getByRole("dialog", { name: "팀 삭제 확인" });
    const confirmBtn = within(dialog).getByRole("button", { name: "영구 삭제" });
    expect(confirmBtn).toBeDisabled(); // 입력 전엔 비활성
    expect(deleteTeamActionMock).not.toHaveBeenCalled();

    // 오타 — 여전히 비활성
    fireEvent.change(within(dialog).getByLabelText("삭제 확인 팀 이름"), {
      target: { value: "알" },
    });
    expect(confirmBtn).toBeDisabled();

    // 정확히 입력 — 활성화 후 클릭
    fireEvent.change(within(dialog).getByLabelText("삭제 확인 팀 이름"), {
      target: { value: "알파" },
    });
    expect(confirmBtn).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    expect(deleteTeamActionMock).toHaveBeenCalledWith("alpha");
    expect(refreshMock).toHaveBeenCalled();
  });
});
