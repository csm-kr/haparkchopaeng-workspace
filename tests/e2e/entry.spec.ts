import { expect, test } from "@playwright/test";

// 진입 흐름(step 3, ADR-018) 비파괴 E2E. DB는 공유 운영 Supabase.
// 검증: ② 초대 링크 미로그인 → 로그인(복귀 next 보존) → dev 로그인 → 초대 화면 복귀.
//       ① 팀 가드가 팀 보유 멤버를 잘못 막지 않는다(앱 진입 허용).
// 주: Google OAuth 실제 왕복은 키 필요 → dev 로그인 폴백으로 검증(playwright.config가 next dev 기동).
//     "팀 없음 → /teams/new" 라우팅 결정은 needsTeamOnboarding 유닛 테스트가 커버한다
//     (공유 운영 DB의 유일 멤버 de8167=jo는 이미 팀 owner라, 팀 없는 멤버를 만드는 건 파괴적).

// ② 미로그인으로 초대 링크에 들어가면 로그인으로 보내고, 복귀 목적지(next)를 보존한다.
test("초대 링크 미로그인 진입 → 로그인 화면 + next 보존", async ({ page }) => {
  await page.goto("/invite/sometoken123");

  // same-origin 복귀 경로가 정제되어 next로 실린다(오픈 리다이렉트 차단).
  await expect(page).toHaveURL(/\/\?next=%2Finvite%2Fsometoken123$/);
  // 로그인 화면이 보인다.
  await expect(page.getByRole("heading", { name: "다시 오셨네요" })).toBeVisible();
});

// ② 로그인 후 원래 가려던 초대 화면으로 복귀한다(dev 로그인 폴백).
test("초대 링크 미로그인 → dev 로그인 → 초대 화면 복귀", async ({ page }) => {
  await page.goto("/invite/return-me");
  await expect(page).toHaveURL(/next=%2Finvite%2Freturn-me$/);

  // dev 이메일 로그인(단일 관리자) — AuthScreen이 next를 읽어 그 경로로 복귀시킨다.
  await page.getByLabel("이메일").fill("de8167@gmail.com");
  await page.getByRole("button", { name: "로그인" }).click();

  // 복귀: 초대 화면(라우팅·가드만 — 수락 UI는 step 4).
  await expect(page).toHaveURL(/\/invite\/return-me$/);
  await expect(page.getByRole("heading", { name: "초대" })).toBeVisible();
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
