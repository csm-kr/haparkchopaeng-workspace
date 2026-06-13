import { expect, test } from "@playwright/test";

// 핵심 경로 1개: dev 로그인(관리자=하수현) → /team → 멤버 4인·역할 배지·초대 블록 렌더.
test("관리자로 팀 관리에 들어가면 멤버 목록·역할 배지·초대 블록이 보인다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 관리자(하수현) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "ha@habakjopaeng.team" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 팀 관리 진입.
  await page.goto("/team");

  // 3) 멤버 4인 + 본인 표시. 이메일은 팀 화면에만 노출되어 유일하게 식별된다
  //    (이름은 사이드바 멤버 목록과 중복되므로 이메일로 확인).
  await expect(page.getByText("멤버 4명")).toBeVisible();
  await expect(page.getByText("ha@habakjopaeng.team")).toBeVisible();
  await expect(page.getByText("paeng@habakjopaeng.team")).toBeVisible();
  await expect(page.getByText("나").first()).toBeVisible();

  // 4) 관리자에게는 초대 블록이 보인다(👑).
  await expect(page.getByLabel("초대할 이메일")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "초대 보내기" }),
  ).toBeVisible();
});
