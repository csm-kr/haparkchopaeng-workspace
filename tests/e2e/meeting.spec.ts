import { expect, test } from "@playwright/test";

// User Flow F1(라이브 세미나 입장·진행)의 비파괴적 분기만 헤드리스 QA한다(LiveKit · ADR-019).
// CRITICAL: DB는 공유 운영 Supabase다 — 실제 active 세션을 만들어 두고 떠나지 않는다(ADR-001/R6).
//   [라이브 시작]은 LiveKit 키가 있으면 전역 live를 켜므로, 아래 테스트는 "키 미설정 환경"의
//   정직한 게이팅(503 안내)만 검증한다. /start는 키 체크(503)가 세션 생성보다 먼저라(키 없으면
//   prisma.liveSession.create 도달 전 반환) 클릭해도 세션이 생기지 않는다 — 비파괴.
// 실제 다자간 송출/재생은 LiveKit 키 런타임 전용이라 헤드리스 검증 대상이 아니다(수동).

test("로그인 후 세미나 라이브는 빈 상태·[라이브 시작] CTA·사이드바 /meeting 링크를 보여준다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 세미나 라이브 진입 — 시드에는 active 세션이 없으므로 정직한 빈 상태(R21/R26 빈).
  await page.goto("/meeting");
  await expect(page.getByText(/아직 진행 중인 세미나가 없어요/)).toBeVisible();

  // 3) 시작 CTA가 노출·활성이다(키 없이 도달 가능한 빈 상태 경로).
  const start = page.getByRole("button", { name: /라이브 시작/ });
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();

  // 4) 셸 정합 — 사이드바 [세미나 라이브] 링크가 /meeting을 가리킨다(SCREENS §영속 셸).
  const meetingLink = page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: /세미나 라이브/ });
  await expect(meetingLink).toHaveAttribute("href", "/meeting");
});

test("키 미설정 환경에서 [라이브 시작]은 친절한 미설정 안내(503)를 보여주고 전역 live를 켜지 않는다", async ({
  page,
}) => {
  // 1) dev 로그인.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/meeting");
  const start = page.getByRole("button", { name: /라이브 시작/ });
  await expect(start).toBeVisible();

  // 2) 클릭 — LiveKit 키가 없으면 /start는 세션 생성 전에 503으로 끝난다(키 체크 우선).
  //    따라서 공유 DB에 active 세션이 만들어지지 않는다 — 비파괴(메모리: e2e 비파괴 원칙).
  await start.click();

  // 3) 친절한 사유 메시지(R30) — "연결되지 않았어요" 류. 정체불명 500/raw 노출 금지.
  await expect(page.getByText(/연결되지 않았어요/)).toBeVisible();

  // 4) 전역 live는 켜지지 않았다 — 빈 상태가 유지되고 룸으로 진입하지 않는다(setLive 미호출).
  await expect(page.getByText(/아직 진행 중인 세미나가 없어요/)).toBeVisible();
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
