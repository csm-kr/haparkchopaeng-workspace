import { expect, test } from "@playwright/test";

// 핵심 경로 1개: dev 로그인 → 빈 달(/schedule?y=2026&m=9, 시드 없음) → 빈 상태 + [일정 짜기]
// → 클릭 시 편집 모드(주차 행 + 저장 바)로 진입. (6월은 시드가 있어 빈 달로 이동해 검증)
test("로그인 후 빈 달에서 [일정 짜기]를 누르면 편집 모드로 들어간다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버(하수현, 관리자) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "ha@habakjopaeng.team" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 빈 달로 이동 — 9월 2026은 시드가 없으므로 진짜 빈 상태(R15/ADR-006).
  await page.goto("/schedule?y=2026&m=9");
  await expect(page.getByText("이 달은 아직 일정이 없어요")).toBeVisible();

  const plan = page.getByRole("button", { name: "일정 짜기" });
  await expect(plan).toBeVisible();

  // 3) [일정 짜기] → 초안 생성 → 편집 모드(저장 바 + 주차 행).
  await plan.click();
  await expect(page.getByRole("button", { name: "저장" })).toBeVisible();
  await expect(page.getByText(/확정 \d+\/\d+/)).toBeVisible();
  // 발표자 select가 보이면 편집 모드 진입 성공.
  await expect(page.getByLabel("1주차 발표자")).toBeVisible();
});
