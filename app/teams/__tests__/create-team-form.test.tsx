import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CreateTeamForm } from "../create-team-form";

// 팀 허브 만들기 폼(ADR-021) — 상한 가시화 추가.
// CRITICAL: 상한 도달은 토스트가 아니라 인라인 안내(R30). 입력·버튼 비활성.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../actions", () => ({ createTeamAction: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreateTeamForm", () => {
  it("canCreate=true면 입력이 활성이고 상한 안내가 없다", () => {
    render(<CreateTeamForm canCreate={true} />);
    expect(screen.getByLabelText("팀 이름")).toBeEnabled();
    expect(screen.queryByText(/최대 팀 수에 도달했어요/)).toBeNull();
  });

  it("canCreate=false면 입력·버튼 비활성 + '최대 팀 수에 도달했어요' 안내", () => {
    render(<CreateTeamForm canCreate={false} />);
    expect(screen.getByLabelText("팀 이름")).toBeDisabled();
    expect(screen.getByRole("button", { name: "팀 만들기" })).toBeDisabled();
    expect(screen.getByText(/최대 팀 수에 도달했어요/)).toBeInTheDocument();
  });
});
