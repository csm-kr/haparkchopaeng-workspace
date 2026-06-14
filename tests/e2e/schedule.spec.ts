import { expect, test } from "@playwright/test";

// 핵심 경로 1개: dev 로그인 → 빈 달(/schedule?y=2026&m=9, 시드 없음) → 빈 상태 + [일정 짜기]
// → 클릭 시 편집 모드(주차 행 + 저장 바)로 진입. (6월은 시드가 있어 빈 달로 이동해 검증)
test("로그인 후 빈 달에서 [일정 짜기]를 누르면 편집 모드로 들어간다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버(하수현, 관리자) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 빈 달로 이동 — 9월 2026은 시드가 없으므로 진짜 빈 상태(R15/ADR-006).
  await page.goto("/schedule?y=2026&m=9");
  await expect(page.getByText("이 달은 아직 일정이 없어요")).toBeVisible();

  const plan = page.getByRole("button", { name: "일정 짜기" });
  await expect(plan).toBeVisible();

  // 3) [일정 짜기] → 초안 생성 → 편집 모드(저장 바 + 주차 행).
  // 비파괴: onDraft(draftMonthAction)는 순수 계산이라 DB에 쓰지 않는다(actions.ts CRITICAL).
  // [저장](saveMonth)만 영속화 + 순번 포인터 전진 → 절대 누르지 않는다(F4 ※).
  await plan.click();
  await expect(page.getByRole("button", { name: "저장" })).toBeVisible();
  await expect(page.getByText(/확정 \d+\/\d+/)).toBeVisible();
  // 발표자 select가 보이면 편집 모드 진입 성공.
  await expect(page.getByLabel("1주차 발표자")).toBeVisible();
});

// F4 비파괴 분기 ①: 편집 모드에서 [취소] → 초안 폐기 → 다시 빈 상태로.
// 갓 만든 초안은 변경분이 없어(isDirty=false) 한 번에 취소된다(schedule-board cancel()).
test("편집 모드에서 [취소]를 누르면 초안이 사라지고 빈 상태로 돌아온다", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/schedule?y=2026&m=9");
  await page.getByRole("button", { name: "일정 짜기" }).click();
  // 편집 모드 진입 확인.
  await expect(page.getByRole("button", { name: "저장" })).toBeVisible();

  // [취소] → 편집 종료 → 빈 상태 복귀(비파괴: DB 변경 없음).
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByText("이 달은 아직 일정이 없어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "일정 짜기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "저장" })).toBeHidden();
});

// F4 비파괴 분기 ②: 편집 중 달 이동 잠금(R16/SCREEN_FLOW §schedule).
// [다음 달]을 눌러도 인라인 경고만 뜨고 달은 바뀌지 않는다(router.push 미호출).
test("편집 중에는 달 이동이 잠긴다", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/schedule?y=2026&m=9");
  await page.getByRole("button", { name: "일정 짜기" }).click();
  await expect(page.getByRole("button", { name: "저장" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "2026년 9월" }),
  ).toBeVisible();

  // 편집 중 [다음 달] → 잠금 경고 + 달 유지(URL·헤딩 불변, 편집 모드 유지).
  await page.getByRole("button", { name: "다음 달" }).click();
  await expect(
    page.getByText("편집 중에는 달을 옮길 수 없어요. 저장하거나 취소해주세요."),
  ).toBeVisible();
  await expect(page).toHaveURL(/m=9(\b|&|$)/);
  await expect(
    page.getByRole("heading", { name: "2026년 9월" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "저장" })).toBeVisible();
});
