import { expect, test } from "@playwright/test";

// 진입 흐름(step 3·4, ADR-018) 비파괴 E2E. DB는 공유 운영 Supabase.
// 검증: ② 초대 수락 화면(검증 순서 카드) — 알 수 없는 토큰은 not_found 카드(가입 불가).
//       ② dev 로그인 후 복귀(next 보존) 플러밍.
//       ① 팀 가드가 팀 보유 멤버를 잘못 막지 않는다(앱 진입 허용).
// 주: Google OAuth 실제 왕복은 키 필요 → dev 로그인 폴백으로 검증(playwright.config가 next dev 기동).
//     실제 토큰 수락(합류)은 멤버십을 쓰는 파괴적 변경 → 유닛 테스트(acceptInvite/acceptInviteAction)가 커버.
//     "팀 없음 → /teams/new" 라우팅 결정은 needsTeamOnboarding 유닛 테스트가 커버한다.

// ② step4: 초대 페이지는 더 이상 미로그인을 즉시 로그인으로 튕기지 않고, 토큰 상태 카드를 보여준다.
//    알 수 없는 토큰은 not_found 사유 카드(R30) — 미로그인이어도 사유를 그대로 안내한다.
test("알 수 없는 초대 토큰은 not_found 카드를 보인다(미로그인, 리다이렉트 없음)", async ({
  page,
}) => {
  await page.goto("/invite/sometoken123");

  // 로그인으로 튕기지 않는다 — 초대 화면에 머문다.
  await expect(page).toHaveURL(/\/invite\/sometoken123$/);
  await expect(
    page.getByRole("heading", { name: "초대를 찾을 수 없어요" }),
  ).toBeVisible();
});

// ② dev 로그인 후 복귀(next 보존) — 로그인 화면에서 초대 경로로 정확히 돌아온다.
test("dev 로그인 시 next로 초대 화면에 복귀한다", async ({ page }) => {
  // same-origin 복귀 경로가 정제되어 next로 실린다(오픈 리다이렉트 차단 — sanitizeNext).
  await page.goto("/?next=%2Finvite%2Freturn-me");
  await expect(page.getByRole("heading", { name: "다시 오셨네요" })).toBeVisible();

  // dev 이메일 로그인(단일 관리자) — AuthScreen이 next를 읽어 그 경로로 복귀시킨다.
  await page.getByLabel("이메일").fill("de8167@gmail.com");
  await page.getByRole("button", { name: "로그인" }).click();

  // 복귀: 초대 화면(return-me는 실재하지 않으니 not_found 카드 — 라우팅 복귀만 검증).
  await expect(page).toHaveURL(/\/invite\/return-me$/);
  await expect(
    page.getByRole("heading", { name: "초대를 찾을 수 없어요" }),
  ).toBeVisible();
});

// ① 팀을 가진 멤버는 팀 가드에 막히지 않고 앱(대시보드)에 진입한다(/teams/new로 튕기지 않음).
test("팀 보유 멤버는 앱 진입 시 /teams/new로 리다이렉트되지 않는다", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" }, // jo = team habakjopaeng owner
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/); // 팀 만들기로 튕기지 않음
});
