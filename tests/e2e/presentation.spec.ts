import { expect, test } from "@playwright/test";

// 핵심 경로 1개: dev 로그인 → /presentations → 항목 클릭 → 상세에서 기존 댓글 렌더 확인.
// 시드 pres1에는 회고 댓글이 있다(@멘션 포함).
test("발표 자료 목록에서 항목을 열면 자료 뷰어와 회고 댓글이 보인다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버(하수현) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "ha@habakjopaeng.team" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 발표 자료 목록 진입 → 항목(pres1) 클릭.
  await page.goto("/presentations");
  await page.getByRole("link", { name: /Mixture-of-Depths/ }).first().click();

  // 3) 상세 — 회고 댓글 섹션 + 시드 댓글이 보인다.
  await expect(
    page.getByRole("heading", { name: /회고 댓글/ }),
  ).toBeVisible();
  await expect(page.getByText(/batch size 영향 부분/)).toBeVisible();
});
