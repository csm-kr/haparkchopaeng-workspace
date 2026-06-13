import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TeamManager } from "../team-manager";
import type {
  PendingInviteView,
  RemoveActionResult,
  RoleActionResult,
  TeamMemberView,
} from "../types";

// 팀 관리 섬 — RTL. 관리 액션은 서버에서 강제되지만(👑), UI 게이팅·확인·검증을 확인한다.

const members: TeamMemberView[] = [
  { id: "ha", name: "하수현", handle: "@hajieun", email: "ha@habakjopaeng.team", role: "관리자", color: "var(--m-ha)", initial: "하" },
  { id: "bak", name: "박진희", handle: "@parksj", email: "park@habakjopaeng.team", role: "멤버", color: "var(--m-bak)", initial: "박" },
  { id: "jo", name: "조성민", handle: "@chominho", email: "cho@habakjopaeng.team", role: "멤버", color: "var(--m-jo)", initial: "조" },
  { id: "paeng", name: "팽진욱", handle: "@paengjh", email: "paeng@habakjopaeng.team", role: "게스트", color: "var(--m-paeng)", initial: "팽" },
];

const invites: PendingInviteView[] = [
  { id: "i1", email: "yoon@university.ac.kr", role: "멤버", createdAt: "2026-06-11T00:00:00.000Z" },
  { id: "i2", email: "intern.kim@university.ac.kr", role: "게스트", createdAt: "2026-06-12T00:00:00.000Z" },
];

function renderTeam(opts?: {
  isAdmin?: boolean;
  currentUserId?: string;
  onChangeRole?: (i: { memberId: string; role: TeamMemberView["role"] }) => Promise<RoleActionResult>;
  onRemoveMember?: (i: { memberId: string }) => Promise<RemoveActionResult>;
}) {
  const onChangeRole =
    opts?.onChangeRole ?? vi.fn(async (): Promise<RoleActionResult> => ({ ok: false, message: "" }));
  const onRemoveMember =
    opts?.onRemoveMember ?? vi.fn(async (): Promise<RemoveActionResult> => ({ ok: true, memberId: "bak" }));
  render(
    <TeamManager
      members={members}
      invites={invites}
      currentUserId={opts?.currentUserId ?? "ha"}
      isAdmin={opts?.isAdmin ?? true}
      onChangeRole={onChangeRole}
      onRemoveMember={onRemoveMember}
    />,
  );
  return { onChangeRole, onRemoveMember };
}

describe("TeamManager", () => {
  it("멤버 4인을 행으로 렌더하고 역할 배지를 색+텍스트로 보인다", () => {
    renderTeam();
    expect(screen.getByText("멤버 4명")).toBeInTheDocument();
    for (const m of members) {
      expect(screen.getByText(m.name)).toBeInTheDocument();
      expect(screen.getByText(m.email)).toBeInTheDocument();
    }
    // 역할 배지는 텍스트로 병행 표기(R29) — 관리자 1, 멤버 2(+초대 멤버), 게스트 등.
    expect(screen.getAllByText("관리자").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("멤버").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("게스트").length).toBeGreaterThanOrEqual(1);
  });

  it("본인 행에는 '나' 표시가 있고 관리 메뉴(⋯)가 없다", () => {
    renderTeam({ currentUserId: "ha" });
    expect(screen.getByText("나")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "하수현 관리 메뉴" }),
    ).not.toBeInTheDocument();
    // 다른 멤버에는 관리 메뉴가 있다.
    expect(
      screen.getByRole("button", { name: "박진희 관리 메뉴" }),
    ).toBeInTheDocument();
  });

  it("대기 중인 초대를 점선 행으로 보인다(재전송/취소)", () => {
    renderTeam();
    const section = screen.getByRole("region", { name: "대기 중인 초대" });
    expect(within(section).getByText("yoon@university.ac.kr")).toBeInTheDocument();
    expect(within(section).getByText("intern.kim@university.ac.kr")).toBeInTheDocument();
    expect(within(section).getAllByText("재전송").length).toBe(2);
    expect(within(section).getAllByText("취소").length).toBe(2);
  });

  it("내보내기는 확인 다이얼로그를 거친다(즉시 실행하지 않음, R27)", async () => {
    const onRemoveMember = vi.fn(
      async (): Promise<RemoveActionResult> => ({ ok: true, memberId: "bak" }),
    );
    renderTeam({ onRemoveMember });

    fireEvent.click(screen.getByRole("button", { name: "박진희 관리 메뉴" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "내보내기" }));

    // 확인 다이얼로그가 뜨고, 아직 서버 액션은 호출되지 않는다.
    const dialog = screen.getByRole("dialog", { name: "멤버 내보내기 확인" });
    expect(within(dialog).getByText("박진희님을 내보낼까요?")).toBeInTheDocument();
    expect(onRemoveMember).not.toHaveBeenCalled();

    // 확인 버튼을 눌러야 비로소 실행된다.
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "내보내기" }));
    });
    expect(onRemoveMember).toHaveBeenCalledWith({ memberId: "bak" });
  });

  it("역할 변경 메뉴에서 새 역할을 고르면 서버 액션을 호출한다", async () => {
    const onChangeRole = vi.fn(
      async (): Promise<RoleActionResult> => ({
        ok: true,
        member: { ...members[1], role: "관리자" },
      }),
    );
    renderTeam({ onChangeRole });

    fireEvent.click(screen.getByRole("button", { name: "박진희 관리 메뉴" }));
    const menu = screen.getByRole("menu");
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "관리자" }));
    });

    expect(onChangeRole).toHaveBeenCalledWith({ memberId: "bak", role: "관리자" });
  });

  it("비관리자에게는 초대 블록·관리 메뉴를 숨기고 안내를 보인다(R19)", () => {
    renderTeam({ isAdmin: false, currentUserId: "bak" });
    // 초대 입력이 없고 안내 문구가 보인다.
    expect(screen.queryByLabelText("초대할 이메일")).not.toBeInTheDocument();
    expect(
      screen.getByText("멤버 초대·역할 변경은 관리자만 할 수 있어요."),
    ).toBeInTheDocument();
    // 다른 멤버 관리 메뉴(⋯)도 없다.
    expect(
      screen.queryByRole("button", { name: "하수현 관리 메뉴" }),
    ).not.toBeInTheDocument();
    // 대기 초대 섹션도 관리자 전용이라 보이지 않는다.
    expect(
      screen.queryByRole("region", { name: "대기 중인 초대" }),
    ).not.toBeInTheDocument();
  });
});
