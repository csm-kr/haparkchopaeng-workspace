import { expect, test } from "@playwright/test";

// 핵심 경로 1개: dev 로그인 → 대시보드 렌더 → live=false 기본이므로 LIVE 배너 없음.
// 컴포넌트/단위 검증(퀵 카드 props, LIVE 배너 컨텍스트 의존)은 Vitest+RTL이 담당한다.
test("로그인 후 대시보드가 렌더되고 라이브가 없으면 LIVE 배너가 없다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버(하수현) 이메일로 세션 쿠키 확보.
  //    page.request는 브라우저 컨텍스트와 쿠키 저장소를 공유한다.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "ha@habakjopaeng.team" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 대시보드 진입 → 셸(사이드바 내비) + 퀵 카드 렌더 확인.
  await page.goto("/dashboard");
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /발표 자료 \d+개/ }),
  ).toBeVisible();

  // 3) live===false 기본 — LIVE 배너(role=status)가 보이지 않는다.
  await expect(page.getByText("진행 중이에요")).toHaveCount(0);
});
