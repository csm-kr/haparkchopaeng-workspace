import { expect, test } from "@playwright/test";

// 핵심 경로 1개: dev 로그인 → /library → 시드 논문 행 렌더(5건) + 필터 칩 "전체" 단일.
// 첫 행 클릭 시 /papers/...로 URL 전이(상세는 다음 step이라 전이까지만 확인).
test("로그인 후 논문 목록이 렌더되고 필터는 '전체' 하나이며 행 클릭이 상세로 이동한다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버(하수현) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "ha@habakjopaeng.team" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 논문 목록 진입 → 행(시드 5건)이 렌더된다.
  await page.goto("/library");
  const rows = page.locator("a.paper-row");
  await expect(rows).toHaveCount(5);

  // 3) 필터 칩은 "전체" 하나뿐(타입 필터 없음, R17).
  await expect(page.getByText("전체", { exact: true })).toHaveCount(1);

  // 4) 첫 행 클릭 → /papers/... 로 URL 전이.
  await rows.first().click();
  await expect(page).toHaveURL(/\/papers\//);
});
