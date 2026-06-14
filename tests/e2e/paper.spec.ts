import { expect, test } from "@playwright/test";

// 핵심 경로 1개: dev 로그인 → /papers/p1(시드, 분석 ready) → 연구 섹션 표시 →
// 관점 토글로 재구현 섹션 전환 → Figure 분석이 두 관점 모두에서 보임.
test("논문 상세에서 관점을 토글하면 섹션이 바뀌고 Figure는 두 관점 공통으로 보인다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버(하수현) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 시드 논문 p1(분석 ready) 상세 진입.
  await page.goto("/papers/p1");

  // 3) 연구 관점 섹션이 보인다.
  await expect(
    page.getByRole("heading", { name: "Contribution" }),
  ).toBeVisible();

  // 4) Figure 분석은 연구 관점에서 노출된다(두 관점 공통, 하단 고정).
  const figureHeading = page.getByRole("heading", { name: "Figure 분석" });
  await expect(figureHeading).toBeVisible();

  // 5) 재구현으로 토글 → 재구현 섹션으로 전환, 연구 전용 섹션은 사라진다.
  await page.getByRole("button", { name: /재구현 분석/ }).click();
  await expect(page.getByRole("heading", { name: "데이터" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Contribution" }),
  ).toHaveCount(0);

  // 6) Figure 분석은 재구현 관점에서도 그대로 보인다.
  await expect(figureHeading).toBeVisible();
});
