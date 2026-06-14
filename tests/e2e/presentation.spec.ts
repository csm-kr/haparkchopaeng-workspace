import { expect, test } from "@playwright/test";

// 핵심 경로: dev 로그인 → /presentations → 정상 렌더.
// 운영 공유 DB라 발표 수는 가변 — 항목(행) 또는 빈 상태 중 하나가 보이면 통과.
// (상세 뷰어·회고 댓글 검증은 실제 발표 자료 고정 시드가 생기면 추후.)
test("로그인 후 발표 자료 목록이 정상 렌더된다(목록 또는 빈 상태)", async ({
  page,
}) => {
  // 1) dev 로그인 — 단일 관리자(조성민) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 발표 자료 목록 진입 → 항목 또는 빈 상태가 보인다.
  await page.goto("/presentations");
  await expect(
    page
      .locator("a.presentation-row")
      .first()
      .or(page.getByText("발표 자료가 아직 없어요")),
  ).toBeVisible();
});
