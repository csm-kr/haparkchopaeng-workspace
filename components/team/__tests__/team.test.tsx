import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TeamManager } from "../team-manager";
import type { PendingInviteView, TeamMemberView } from "../types";

// 팀 관리 섬 — RTL. 멀티팀(ADR-018): 역할 영어 표기(owner/admin/member)·이메일 입력 없음·토큰 초대 링크 생성.
// 관리 액션은 서버(route handler)가 최종 강제(R19) — 여기선 UI 게이팅·확인·fetch 호출을 확인한다.

// 팀 나가기 성공 시 /teams로 이동하므로 useRouter를 모킹한다.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const members: TeamMemberView[] = [
  { id: "ha", name: "하수현", handle: "@hajieun", email: "ha@habakjopaeng.team", role: "owner", color: "var(--m-ha)", initial: "하" },
  { id: "bak", name: "박진희", handle: "@parksj", email: "park@habakjopaeng.team", role: "admin", color: "var(--m-bak)", initial: "박" },
  { id: "jo", name: "조성민", handle: "@chominho", email: "cho@habakjopaeng.team", role: "member", color: "var(--m-jo)", initial: "조" },
];

// 토큰 초대(ADR-018) — 이메일 없음, 역할 admin|member, 사용 횟수 표기.
const invites: PendingInviteView[] = [
  { id: "i1", role: "member", maxUses: 1, usedCount: 0, expiresAt: "2026-06-22T00:00:00.000Z", createdAt: "2026-06-11T00:00:00.000Z" },
  { id: "i2", role: "admin", maxUses: 5, usedCount: 2, expiresAt: "2026-06-23T00:00:00.000Z", createdAt: "2026-06-12T00:00:00.000Z" },
];

function jsonRes(data: unknown, ok = true) {
  return { ok, json: async () => ({ data }) } as unknown as Response;
}

function renderTeam(opts?: {
  currentUserRole?: TeamMemberView["role"];
  currentUserId?: string;
  invites?: PendingInviteView[];
}) {
  render(
    <TeamManager
      teamSlug="crew"
      members={members}
      invites={opts?.invites ?? invites}
      currentUserId={opts?.currentUserId ?? "ha"}
      currentUserRole={opts?.currentUserRole ?? "owner"}
    />,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  pushMock.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeamManager", () => {
  it("멤버를 행으로 렌더하고 역할 배지를 영어로 보인다(owner/admin/member)", () => {
    renderTeam();
    expect(screen.getByText("멤버 3명")).toBeInTheDocument();
    for (const m of members) {
      expect(screen.getByText(m.name)).toBeInTheDocument();
      expect(screen.getByText(m.email)).toBeInTheDocument();
    }
    // 역할은 영어 그대로(R29: 색+텍스트). 한국어(팀장/관리자/팀원) 표기 없음.
    expect(screen.getAllByText("owner").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("member").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("팀장")).not.toBeInTheDocument();
    expect(screen.queryByText("관리자")).not.toBeInTheDocument();
  });

  it("본인 행에는 '나' 표시가 있고 관리 메뉴(⋯)가 없다", () => {
    renderTeam({ currentUserId: "ha", currentUserRole: "owner" });
    expect(screen.getByText("나")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "하수현 관리 메뉴" }),
    ).not.toBeInTheDocument();
  });

  it("owner 행에는 관리 메뉴가 없다(강등·추방 불가)", () => {
    // 다른 owner가 있어도 그 행엔 메뉴가 붙지 않는다(팀당 owner ≥ 1, 보호).
    renderTeam({ currentUserId: "bak", currentUserRole: "owner" });
    expect(
      screen.queryByRole("button", { name: "하수현 관리 메뉴" }),
    ).not.toBeInTheDocument();
  });

  it("이메일 입력은 없고, owner는 역할·횟수로 초대 링크를 만든다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonRes({
          invite: { id: "i3", role: "member", maxUses: 3, usedCount: 0, expiresAt: "2026-06-30T00:00:00.000Z", createdAt: "2026-06-15T00:00:00.000Z" },
          link: "https://app.test/invite/newtoken",
        }),
      );
    renderTeam();
    // 이메일 입력 제거됨(토큰 초대).
    expect(screen.queryByLabelText("초대할 이메일")).not.toBeInTheDocument();

    // 역할·사용 횟수 입력 후 링크 생성.
    fireEvent.change(screen.getByLabelText("초대 역할"), { target: { value: "member" } });
    fireEvent.change(screen.getByLabelText("사용 횟수"), { target: { value: "3" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "초대 링크 만들기" }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/invites");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ teamSlug: "crew", role: "member", maxUses: 3 });
    // 생성된 링크가 노출된다(복사 UI).
    expect(screen.getByText("https://app.test/invite/newtoken")).toBeInTheDocument();
  });

  it("활성 초대를 점선 행으로 보인다(역할 영어·사용 횟수·회수, 이메일 없음)", () => {
    renderTeam();
    const section = screen.getByRole("region", { name: "대기 중인 초대" });
    expect(within(section).getByText("member")).toBeInTheDocument();
    expect(within(section).getByText("admin")).toBeInTheDocument();
    expect(within(section).getByText("2/5 사용됨")).toBeInTheDocument();
    expect(within(section).getAllByText("회수").length).toBe(2);
  });

  it("초대 회수는 DELETE /api/invites/:id 를 호출한다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ id: "i1" }));
    renderTeam();
    const section = screen.getByRole("region", { name: "대기 중인 초대" });
    await act(async () => {
      fireEvent.click(within(section).getAllByText("회수")[0]);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/invites/i1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("대기 초대의 '링크' 버튼은 resend API로 초대 링크를 다시 노출한다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonRes({ invite: invites[0], link: "https://app.test/invite/again" }),
      );
    renderTeam();
    const section = screen.getByRole("region", { name: "대기 중인 초대" });
    await act(async () => {
      fireEvent.click(
        within(section).getAllByRole("button", { name: "초대 링크 다시 보기" })[0],
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/invites/i1/resend",
      expect.objectContaining({ method: "POST" }),
    );
    // 다시 받은 링크가 복사 UI에 노출된다.
    expect(
      screen.getByText("https://app.test/invite/again"),
    ).toBeInTheDocument();
  });

  it("내보내기는 확인 다이얼로그를 거쳐 DELETE 멤버 API를 호출한다(R27)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ memberId: "jo" }));
    renderTeam({ currentUserId: "ha", currentUserRole: "owner" });

    fireEvent.click(screen.getByRole("button", { name: "조성민 관리 메뉴" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "내보내기" }));

    const dialog = screen.getByRole("dialog", { name: "멤버 내보내기 확인" });
    expect(within(dialog).getByText("조성민님을 내보낼까요?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled(); // 확인 전엔 호출 안 함

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "내보내기" }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/crew/members/jo",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("owner가 역할을 바꾸면 PATCH 멤버 API를 호출한다", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonRes({ memberId: "jo", role: "admin" }));
    renderTeam({ currentUserId: "ha", currentUserRole: "owner" });

    fireEvent.click(screen.getByRole("button", { name: "조성민 관리 메뉴" }));
    const menu = screen.getByRole("menu");
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "admin" }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/crew/members/jo",
      expect.objectContaining({ method: "PATCH" }),
    );
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(String(init?.body))).toEqual({ role: "admin" });
  });

  it("member 시점에는 초대 생성·관리 메뉴를 숨기고 안내를 보인다(R19)", () => {
    renderTeam({ currentUserRole: "member", currentUserId: "jo" });
    expect(screen.queryByLabelText("초대할 이메일")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "초대 링크 만들기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("멤버 초대·역할 변경은 owner·admin만 할 수 있어요."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "하수현 관리 메뉴" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "대기 중인 초대" }),
    ).not.toBeInTheDocument();
  });

  it("비-owner 본인 행에는 '팀 나가기' 버튼이 있다", () => {
    renderTeam({ currentUserId: "jo", currentUserRole: "member" });
    expect(screen.getByRole("button", { name: "팀 나가기" })).toBeInTheDocument();
  });

  it("owner 본인 행에는 '팀 나가기' 버튼이 없다(owner는 탈퇴 불가)", () => {
    renderTeam({ currentUserId: "ha", currentUserRole: "owner" });
    expect(screen.queryByRole("button", { name: "팀 나가기" })).not.toBeInTheDocument();
  });

  it("팀 나가기는 확인을 거쳐 self DELETE 멤버 API를 호출하고 /teams로 이동한다(R27)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ memberId: "jo" }));
    renderTeam({ currentUserId: "jo", currentUserRole: "member" });

    fireEvent.click(screen.getByRole("button", { name: "팀 나가기" }));
    const dialog = screen.getByRole("dialog", { name: "팀 나가기 확인" });
    expect(fetchMock).not.toHaveBeenCalled(); // 확인 전엔 호출 안 함

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "나가기" }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/crew/members/jo",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(pushMock).toHaveBeenCalledWith("/teams");
  });
});
