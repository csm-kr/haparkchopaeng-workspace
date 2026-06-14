import { expect, test } from "@playwright/test";

// USER_FLOW "전역 인터랙션" / "전역 상태·피드백 규칙"의 비파괴 분기만 헤드리스 QA한다.
// DB는 공유 운영 Supabase다 — 영속 변경 금지. 로그아웃은 세션 쿠키만 지운다(브라우저 컨텍스트
// 한정, 공유 DB 불변)이라 허용된다(step 7 공통 제약). 로그인: POST /api/auth/login(단일 관리자).
//
// 범위 메모(코드로 확인한 미포팅 UI — 단언하지 않고 생략):
//  - 명령 팔레트(Cmd/Ctrl+K): 프로덕션 셸(components/shell/*)·app/(app)/* 어디에도
//    cmdk/keydown 핸들러나 role=dialog 팔레트가 없다. 프로토타입의 CommandPalette는
//    아직 포팅되지 않았다 → 해당 케이스 생략(가정 단언 금지, step 금지사항).
//  - 통합 검색: 검색 입력/결과 UI도 셸·화면에 존재하지 않는다 → 생략.
//  두 항목은 QA_REPORT.md에 "미포팅(범위 밖)"으로 사유를 남긴다.

test("사이드바 내비게이션으로 주요 화면 사이를 이동할 수 있다", async ({ page }) => {
  // 1) dev 로그인 — 단일 관리자(de8167) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 셸 진입 — 영속 사이드바의 "주요 메뉴" 내비가 보인다.
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "주요 메뉴" });
  await expect(nav).toBeVisible();

  // 3) 대표 경로 3개를 클릭해 URL과 활성 표시(aria-current=page)로 단언(데이터 무관).
  //    활성 링크는 pathname 일치 시 aria-current="page"가 붙는다(shell/sidebar) — 셸 재렌더 증거.
  await nav.getByRole("link", { name: "논문", exact: true }).click();
  await expect(page).toHaveURL(/\/library(\?|$)/);
  await expect(
    nav.getByRole("link", { name: "논문", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "발표 자료", exact: true }).click();
  await expect(page).toHaveURL(/\/presentations(\?|$)/);
  await expect(
    nav.getByRole("link", { name: "발표 자료", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  // 스케쥴은 데이터와 무관한 고정 마커(h1 "세미나 스케줄")까지 함께 확인.
  await nav.getByRole("link", { name: "스케쥴", exact: true }).click();
  await expect(page).toHaveURL(/\/schedule(\?|$)/);
  await expect(
    nav.getByRole("link", { name: "스케쥴", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "세미나 스케줄" }),
  ).toBeVisible();
});

test("로그아웃하면 보호 라우트 접근 시 로그인 화면으로 리다이렉트된다", async ({
  page,
}) => {
  // 1) dev 로그인 후 보호 라우트가 정상 렌더되는지 기준선 확인(로그인 상태).
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/dashboard");
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴" }),
  ).toBeVisible();

  // 2) 로그아웃 — 셸 UI에 로그아웃 버튼이 없어(코드 확인) API로 세션 쿠키만 파기한다.
  //    page.request는 브라우저 컨텍스트 쿠키를 공유하므로 이후 내비에 반영된다.
  //    이 경로는 세션 쿠키만 지운다 — dev 세션엔 Supabase IdP 세션이 없어 signOut은 무영향,
  //    공유 운영 DB는 불변(비파괴 허용 범위, step 7 공통 제약).
  const logout = await page.request.post("/api/auth/logout");
  expect(logout.ok()).toBeTruthy();

  // 3) 보호 라우트(/dashboard) 재접근 → 미인증이라 홈(로그인)으로 리다이렉트한다
  //    (app/(app)/layout.tsx: getSession() 없으면 redirect("/")).
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/); // 루트(홈)로
  await expect(
    page.getByRole("heading", { name: "다시 오셨네요" }),
  ).toBeVisible();
});
