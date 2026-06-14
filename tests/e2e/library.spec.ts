import { expect, test } from "@playwright/test";

// 핵심 경로: dev 로그인(단일 관리자) → /library → 정상 렌더.
// 운영 공유 DB라 논문 수는 가변(업로드/삭제) — 목록(행) 또는 빈 상태 중 하나가 보이면 통과.
test("로그인 후 라이브러리가 정상 렌더된다(논문 목록 또는 빈 상태)", async ({
  page,
}) => {
  // 1) dev 로그인 — 단일 관리자(조성민) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 논문 목록 진입 → 행 또는 빈 상태가 보인다(데이터 수에 의존하지 않음).
  await page.goto("/library");
  await expect(
    page
      .locator("a.paper-row")
      .first()
      .or(page.getByText("아직 올라온 논문이 없어요")),
  ).toBeVisible();

  // 3) 에러 카드는 아니어야 한다.
  await expect(page.getByText("논문 목록을 불러오지 못했어요")).toHaveCount(0);
});
