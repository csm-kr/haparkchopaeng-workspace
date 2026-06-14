import { expect, test } from "@playwright/test";

// 핵심 경로 1개: dev 로그인 → /meeting → 라이브 없음 빈 상태 + [라이브 시작] 노출.
// 실제 송출/재생은 Cloudflare 키 런타임 전용이라 검증 대상이 아니다(빈 상태까지만, 키 없이 가능).
test("로그인 후 세미나 라이브는 빈 상태와 [라이브 시작] 버튼을 보여준다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버(하수현) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 세미나 라이브 진입 — 시드에는 active 세션이 없으므로 빈 상태.
  await page.goto("/meeting");
  await expect(page.getByText(/아직 진행 중인 세미나가 없어요/)).toBeVisible();

  // 3) 시작 CTA가 노출된다(키 없이 가능한 경로).
  await expect(page.getByRole("button", { name: /라이브 시작/ })).toBeVisible();
});
