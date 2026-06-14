import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TeamSwitcher } from "../team-switcher";
import type { ShellTeam } from "../types";

// 셸 팀 전환(ADR-018, 최소 동작): 현재 팀 표시 + 멤버십 팀 간 전환 링크.
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

const ALPHA: ShellTeam = { slug: "alpha", name: "알파" };
const BETA: ShellTeam = { slug: "beta", name: "베타" };

describe("TeamSwitcher", () => {
  it("팀이 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<TeamSwitcher teams={[]} activeSlug={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("팀이 하나면 현재 팀 이름만 단순 표시한다(전환 목록 없음)", () => {
    render(<TeamSwitcher teams={[ALPHA]} activeSlug="alpha" />);
    expect(screen.getByText("알파")).toBeInTheDocument();
    // 전환할 다른 팀이 없으므로 다른-팀 목록은 없다.
    expect(screen.queryByRole("list", { name: "다른 팀" })).toBeNull();
  });

  it("팀이 여러 개면 현재 팀을 표시하고 나머지를 전환 링크로 보여준다", () => {
    render(<TeamSwitcher teams={[BETA, ALPHA]} activeSlug="beta" />);
    // 현재(active) 팀.
    const region = screen.getByRole("region", { name: "팀 전환" });
    expect(within(region).getByText("베타")).toBeInTheDocument();
    // 다른 팀(알파)은 전환 링크로.
    const list = screen.getByRole("list", { name: "다른 팀" });
    const link = within(list).getByRole("link", { name: "알파" });
    expect(link).toBeInTheDocument();
  });

  it("activeSlug가 멤버십에 없으면 가장 최근(첫) 팀을 현재로 본다", () => {
    render(<TeamSwitcher teams={[BETA, ALPHA]} activeSlug={null} />);
    const region = screen.getByRole("region", { name: "팀 전환" });
    // 첫 팀(베타)이 현재 — 다른 팀 목록엔 알파만.
    const list = screen.getByRole("list", { name: "다른 팀" });
    expect(within(list).getByRole("link", { name: "알파" })).toBeInTheDocument();
    expect(within(list).queryByRole("link", { name: "베타" })).toBeNull();
  });
});
