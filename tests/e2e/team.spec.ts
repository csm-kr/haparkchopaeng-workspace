import { expect, test } from "@playwright/test";

// 핵심 경로: dev 로그인(관리자=조성민) → /team → 단일 관리자 본인 + 초대 블록 렌더.
// (멤버는 관리자가 초대해 늘린다 — 초기엔 본인 1명.)
test("관리자로 팀 관리에 들어가면 본인 멤버와 초대 블록이 보인다", async ({
  page,
}) => {
  // 1) dev 로그인 — 단일 관리자(조성민) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 팀 관리 진입.
  await page.goto("/team");

  // 3) 본인(조성민) — 이메일은 팀 화면에만 노출되어 유일하게 식별된다.
  await expect(page.getByText("de8167@gmail.com")).toBeVisible();
  await expect(page.getByText("나").first()).toBeVisible();

  // 4) 관리자에게는 초대 블록이 보인다(👑).
  await expect(page.getByLabel("초대할 이메일")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "초대 보내기" }),
  ).toBeVisible();
});
