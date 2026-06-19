import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LiveProvider, ThemeProvider } from "@/components/providers";
import { Sidebar } from "../sidebar";
import type { ShellMember } from "../types";

// usePathname을 고정한다. TeamSwitcher가 useRouter를 쓰므로 함께 목킹한다(렌더만, 동작 없음).
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ refresh: vi.fn() }),
}));

const CURRENT: ShellMember = {
  id: "ha",
  name: "하수현",
  initial: "하",
  color: "var(--m-ha)",
  role: "관리자",
};

function renderSidebar(opts: { live?: boolean } = {}) {
  return render(
    <ThemeProvider initialTheme="light">
      <LiveProvider initialLive={opts.live ?? false}>
        <Sidebar
          members={[CURRENT]}
          currentUser={CURRENT}
          collapsed={false}
          onToggleCollapse={() => {}}
        />
      </LiveProvider>
    </ThemeProvider>,
  );
}

describe("Sidebar 내비", () => {
  it("내비 항목을 정해진 순서로 렌더한다", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: "주요 메뉴" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((a) => a.textContent?.trim());
    expect(labels).toEqual([
      "홈",
      "논문",
      "NEWS",
      "발표 자료",
      "스케쥴",
      "팀 관리",
      "모두의 세미나",
    ]);
  });

  it("현재 경로 항목에 aria-current=page를 준다", () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: "주요 메뉴" });
    expect(within(nav).getByRole("link", { name: "홈" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("LIVE 알약 (useLive 컨텍스트)", () => {
  it("live=false면 LIVE 알약이 없다", () => {
    renderSidebar({ live: false });
    expect(screen.queryByLabelText("진행 중인 라이브")).toBeNull();
  });

  it("live=true면 모두의 세미나 항목에 LIVE 알약이 보인다", () => {
    renderSidebar({ live: true });
    const pill = screen.getByLabelText("진행 중인 라이브");
    expect(pill).toBeInTheDocument();
    // 색에만 의존하지 않는다 — 텍스트 병행(R29).
    expect(pill).toHaveTextContent("LIVE");
  });
});

describe("테마 토글", () => {
  it("토글 클릭이 <html data-theme>를 전환한다", () => {
    renderSidebar();
    // 초기 light → 다크로 전환하는 버튼이 보인다.
    const toDark = screen.getByRole("button", { name: "다크 테마로 전환" });
    fireEvent.click(toDark);
    expect(document.documentElement.dataset.theme).toBe("dark");

    // 다시 라이트로.
    const toLight = screen.getByRole("button", { name: "라이트 테마로 전환" });
    fireEvent.click(toLight);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
