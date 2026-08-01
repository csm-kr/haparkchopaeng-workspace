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

function renderSidebar(opts: { live?: boolean; collapsed?: boolean } = {}) {
  return render(
    <ThemeProvider initialTheme="light">
      <LiveProvider initialLive={opts.live ?? false}>
        <Sidebar
          members={[CURRENT]}
          currentUser={CURRENT}
          collapsed={opts.collapsed ?? false}
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

describe("접힘 상태 푸터 레이아웃", () => {
  // jsdom은 레이아웃을 계산하지 않으므로 배치 클래스로 검증한다.
  // 접힘 폭 64px - px-3 양쪽 = 40px 인데 아바타(20) + gap(8) + 토글(32) = 60px 라
  // 가로 배치로는 넘쳐서 겹친다. 헤더(로고+접기 토글)와 같은 세로 스택 처리가 필요하다.
  function footerOf() {
    return screen.getByRole("button", { name: "다크 테마로 전환" }).parentElement;
  }

  it("접히면 푸터를 세로로 쌓는다", () => {
    renderSidebar({ collapsed: true });
    expect(footerOf()).toHaveClass("flex-col");
  });

  it("펼치면 푸터를 가로로 둔다", () => {
    renderSidebar({ collapsed: false });
    expect(footerOf()).not.toHaveClass("flex-col");
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
