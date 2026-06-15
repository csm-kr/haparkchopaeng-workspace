import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TeamSwitcher } from "../team-switcher";
import type { ShellTeam } from "../types";

// 셸 팀 전환(ADR-018/ADR-020): 현재 팀 표시 + 다른 팀으로 실제 전환.
// 전환은 POST /api/teams/active로 활성 팀 쿠키를 바꾼 뒤 router.refresh()로 RSC를 다시 그린다.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);

const ALPHA: ShellTeam = { slug: "alpha", name: "알파" };
const BETA: ShellTeam = { slug: "beta", name: "베타" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("TeamSwitcher", () => {
  it("팀이 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<TeamSwitcher teams={[]} activeSlug={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("팀이 하나면 현재 팀 이름만 표시한다(전환 목록 없음)", () => {
    render(<TeamSwitcher teams={[ALPHA]} activeSlug="alpha" />);
    expect(screen.getByText("알파")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "다른 팀" })).toBeNull();
  });

  it("팀이 여러 개면 현재 팀을 표시하고 나머지를 전환 버튼으로 보여준다", () => {
    render(<TeamSwitcher teams={[BETA, ALPHA]} activeSlug="beta" />);
    const region = screen.getByRole("region", { name: "팀 전환" });
    expect(within(region).getByText("베타")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "다른 팀" });
    expect(within(list).getByRole("button", { name: "알파" })).toBeInTheDocument();
  });

  it("activeSlug가 멤버십에 없으면 가장 최근(첫) 팀을 현재로 본다", () => {
    render(<TeamSwitcher teams={[BETA, ALPHA]} activeSlug={null} />);
    const list = screen.getByRole("list", { name: "다른 팀" });
    expect(within(list).getByRole("button", { name: "알파" })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "베타" })).toBeNull();
  });

  it("다른 팀 클릭 → POST /api/teams/active {slug} 호출 후 새로고침", async () => {
    render(<TeamSwitcher teams={[BETA, ALPHA]} activeSlug="beta" />);
    fireEvent.click(screen.getByRole("button", { name: "알파" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/teams/active");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ slug: "alpha" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });
});
