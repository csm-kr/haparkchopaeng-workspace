import { expect, test } from "@playwright/test";

// 핵심 경로 1개: dev 로그인 → /profile → 프로필 필드·테마 선택 렌더,
// 테마 버튼이 <html data-theme>를 전환하는지 확인.
test("설정에 들어가면 프로필 필드·테마 선택이 보이고 테마 전환이 data-theme를 바꾼다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버(하수현) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 설정 진입.
  await page.goto("/profile");

  // 3) 프로필 필드와 테마 선택이 렌더된다.
  await expect(page.getByLabel("이름")).toBeVisible();
  await expect(page.getByLabel("핸들")).toBeVisible();
  const themeGroup = page.getByRole("group", { name: "테마 선택" });
  await expect(themeGroup).toBeVisible();

  // 4) 다크 버튼을 누르면 <html data-theme="dark">로 전환된다(R20).
  await themeGroup.getByRole("button", { name: /다크/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // 라이트로 되돌리면 다시 전환된다.
  await themeGroup.getByRole("button", { name: /라이트/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
