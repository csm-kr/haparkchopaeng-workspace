import { expect, test } from "@playwright/test";

// User Flow F1(라이브 세미나 입장·진행)의 비파괴적 분기만 헤드리스 QA한다.
// CRITICAL: DB는 공유 운영 Supabase다 — [라이브 시작]/[종료]는 전역 live를 토글해
// 모든 사용자에게 배너·배지가 뜨므로 절대 클릭하지 않는다(노출/활성만 단언, ADR-001/R6).
// 실제 송출/재생은 Cloudflare 키 런타임 전용이라 검증 대상이 아니다(빈 상태까지만, 키 없이 가능).

test("로그인 후 세미나 라이브는 빈 상태와 [라이브 시작] CTA를 보여준다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버(하수현) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 세미나 라이브 진입 — 시드에는 active 세션이 없으므로 정직한 빈 상태(R21).
  await page.goto("/meeting");
  await expect(page.getByText(/아직 진행 중인 세미나가 없어요/)).toBeVisible();

  // 3) 시작 CTA가 노출·활성이다(키 없이 가능한 경로) — 단, 클릭하지 않는다.
  //    클릭하면 전역 live가 켜져(setLive) 공유 운영 DB가 오염된다(F1 금지사항).
  const start = page.getByRole("button", { name: /라이브 시작/ });
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
  // 주: 프로토타입(src/meeting.jsx)의 [스케줄 보기]·"다음 세미나" 칩은 프로덕션
  //    EmptyState(CTA 하나, R21)로 단순화됐다. 빈 상태 CTA는 [라이브 시작] 하나뿐이며,
  //    schedule 이동은 영속 사이드바로 이뤄진다(아래 비파괴 내비 분기 테스트에서 검증).
});

test("세미나 라이브에서 [스케쥴]로 이동하는 비파괴 분기는 전역 상태를 바꾸지 않는다", async ({
  page,
}) => {
  // 1) dev 로그인.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) meeting 진입 후, F1의 "meeting → schedule" 분기를 영속 사이드바의 [스케쥴]
  //    링크로 검증한다(프로덕션 빈 상태엔 [스케줄 보기] CTA가 없어 사이드바로 대체).
  //    이 내비게이션은 [라이브 시작]을 누르지 않으므로 전역 live를 토글하지 않는다 — 공유 DB 무변경.
  await page.goto("/meeting");
  const scheduleLink = page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: /스케쥴/ });
  await expect(scheduleLink).toBeVisible();
  await scheduleLink.click();

  // 3) /schedule로 이동했고 스케줄 화면이 렌더된다(데이터와 무관한 고정 마커: h1).
  await expect(page).toHaveURL(/\/schedule(\?|$)/);
  await expect(
    page.getByRole("heading", { name: "세미나 스케줄" }),
  ).toBeVisible();
});
