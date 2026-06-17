import { expect, test } from "@playwright/test";

// 진입 팀 허브(ADR-021) 비파괴 E2E. DB는 공유 운영 Supabase다.
// 핵심 경로(USER_FLOW): 로그인 → 팀 허브(/teams) → 팀 선택 → /dashboard.
// 검증: ① 허브 노출 + 팀 선택 진입(활성 팀 쿠키만 변경 — 비파괴).
//       ② 로그인 직후 기본 착지 = /teams(step 2 cutover: app/page가 next ?? "/teams"로 보낸다).
//       ③ 복귀(next)는 팀 허브보다 우선한다(초대 링크 복귀 불변).
//       ④ 팀 만들기 영역의 상한 가시화 — 노출/활성·비활성까지만(제출 금지, 파괴적).
// 로그인: de8167@gmail.com = 단일 owner(ADR-017 dev 로그인). webServer가 next dev로 기동.
// CRITICAL(비파괴): 팀을 실제로 만들지 않는다(공유 운영 DB에 Team/Membership 행 생성 — 되돌리기 어려움).
//   팀 "선택"은 활성 팀 쿠키만 바꾸므로 실제로 눌러 검증한다.

const ADMIN_EMAIL = "de8167@gmail.com"; // jo = 부트스트랩 팀(habakjopaeng) owner

// ① 허브가 내 팀을 보여주고, 팀을 고르면 대시보드로 들어간다.
//    단일 owner 계정이라 최소 1팀 존재 — 선택 대상이 보장된다(ADR-018 부트스트랩 이관).
test("팀 허브에서 내 팀을 고르면 대시보드로 들어간다", async ({ page }) => {
  // dev 로그인 — 세션 쿠키 확보(네비게이션 없이 API로).
  const login = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL },
  });
  expect(login.ok()).toBeTruthy();

  // 허브 도달(직접 방문 — 헤드리스에서 OAuth 왕복 불가, app/page 착지 단언은 ②가 커버).
  await page.goto("/teams");
  await expect(page.getByRole("heading", { name: "팀 선택" })).toBeVisible();

  // "내 팀" 목록(TeamPicker)이 보이고, 선택 가능한 팀이 ≥ 1개다.
  const myTeams = page.getByRole("list", { name: "내 팀" }).getByRole("button");
  await expect(myTeams.first()).toBeVisible();

  // 팀 선택 → POST /api/teams/active(쿠키만 변경, 비파괴) → /dashboard.
  await myTeams.first().click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

// ② 로그인 직후 기본 착지 = 팀 허브(/teams) — step 2 cutover.
//    이미 세션이 있으면 app/page가 next ?? "/teams"로 보낸다(OAuth 콜백 기본 목적지와 동일).
//    실제 Google OAuth 왕복은 키가 필요해 헤드리스에서 불가하므로, 동일 분기(이미 로그인 → 기본 착지)를
//    홈("/") 방문으로 결정적으로 단언한다.
test("로그인 후 홈(/) 방문은 팀 허브(/teams)로 착지한다", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page).toHaveURL(/\/teams$/);
  await expect(page.getByRole("heading", { name: "팀 선택" })).toBeVisible();
});

// ③ 복귀(next)는 팀 허브보다 우선한다 — 초대 링크 복귀 불변(app/page: next ?? "/teams").
//    return-me는 실재하지 않는 토큰이라 not_found 카드 — 라우팅 우선순위(next > /teams)만 단언.
test("복귀(next)가 있으면 팀 허브가 아니라 next로 착지한다", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL },
  });
  expect(login.ok()).toBeTruthy();

  // same-origin 경로만 정제 통과(sanitizeNext) — 오픈 리다이렉트 차단.
  await page.goto("/?next=%2Finvite%2Freturn-me");

  // /teams가 아니라 next(초대 화면)로 간다.
  await expect(page).toHaveURL(/\/invite\/return-me$/);
  await expect(
    page.getByRole("heading", { name: "초대를 찾을 수 없어요" }),
  ).toBeVisible();
});

// ④ 팀 만들기 영역의 상한 가시화 — 공유 DB 상태에 따라 가변(MAX_TEAMS=2).
//    제출하지 않고 노출·활성/비활성까지만 검증한다(CRITICAL: 실제 생성 금지 — 파괴적).
//    canCreate=false면 입력 비활성 + "최대 팀 수에 도달했어요" 안내(R30), 아니면 입력 활성.
test("팀 만들기 영역은 상한 상태를 가시화한다(제출하지 않음)", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/teams");
  await expect(
    page.getByRole("heading", { name: "새 팀 만들기" }),
  ).toBeVisible();

  const nameInput = page.getByLabel("팀 이름");
  await expect(nameInput).toBeVisible();

  // 데이터 가변 분기: 상한 도달이면 안내 + 비활성, 아니면 활성(둘 다 결정적으로 단언 — skip 불필요).
  const limitNote = page.getByText("최대 팀 수에 도달했어요");
  if ((await limitNote.count()) > 0) {
    await expect(limitNote).toBeVisible();
    await expect(nameInput).toBeDisabled();
  } else {
    await expect(nameInput).toBeEnabled();
  }
  // ※ 어느 분기든 [팀 만들기] 제출은 누르지 않는다 — 공유 운영 DB 비파괴.
});
