import { expect, test } from "@playwright/test";

// 팀 스코핑(ADR-020/R37) 비파괴 E2E. DB는 공유 운영 Supabase다.
// 검증: ① 활성 팀 컨텍스트가 셸에 노출(현재 팀 + 팀 전환 섹션, step 2).
//       ② 다른 팀이 있으면 전환 시 화면이 활성 팀으로 다시 그려진다(없으면 단일 팀 graceful — step5 ※).
//       ③ 다른 팀/존재하지 않는 논문 단건 진입 → "찾을 수 없음"(404 등가, R19) + PDF 라우트 404.
//       ④ 라이브는 활성 팀 기준 빈 상태 + 시작 게이팅(키 미설정 시 503 친절 — phase 7과 동일).
// CRITICAL: 실제 2팀 격리 단언은 유닛(step 3·4)이 1차로 커버한다. 공유 운영 DB는 단일 팀일 수
//   있으므로(MAX_TEAMS=2지만 미생성), 다중 팀 분기는 런타임 skip으로 graceful 통과시킨다.
//   팀 전환은 활성 팀 쿠키만 바꾼다(DB 무변경) — 비파괴. 전환 후엔 원래 팀으로 되돌려 둔다.

const ADMIN_EMAIL = "de8167@gmail.com"; // jo = 부트스트랩 팀 owner(ADR-018)

// ① 활성 팀 컨텍스트가 셸에 노출된다 — step2(active-team-context)의 E2E 확인.
//    "현재 팀" 라벨 + 팀 전환 섹션이 보이면 layout이 getActiveTeam을 해소해 셸에 전달한 것이다(ADR-015).
test("활성 팀 컨텍스트가 셸에 노출된다(현재 팀 + 팀 전환 섹션)", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/dashboard");

  // 팀 전환 섹션(사이드바)이 보인다 — 활성 팀이 해소됐다는 증거.
  const region = page.getByRole("region", { name: "팀 전환" });
  await expect(region).toBeVisible();
  await expect(region.getByText("현재 팀")).toBeVisible();

  // 현재 팀 이름(title 속성을 가진 p)이 비어있지 않다(데이터에 의존하지 않는 불변).
  const nameNode = region.locator("p[title]");
  await expect(nameNode).toBeVisible();
  await expect(nameNode).not.toHaveText("");
});

// ② 다른 팀이 있으면 전환 시 활성 팀으로 다시 그려진다(없으면 단일 팀 graceful skip).
//    전환은 POST /api/teams/active(쿠키만 변경, 비파괴) → router.refresh로 RSC 재렌더.
test("다른 팀이 있으면 전환 후 대시보드가 활성 팀으로 다시 그려진다(없으면 graceful skip)", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/dashboard");
  const region = page.getByRole("region", { name: "팀 전환" });
  await expect(region).toBeVisible();

  // 원래 팀 이름 보관(전환 후 되돌리기 위해).
  const originalName = (await region.locator("p[title]").innerText()).trim();

  // "다른 팀" 전환 버튼 목록(단일 팀이면 비어 있음).
  const others = page.getByRole("list", { name: "다른 팀" }).getByRole("button");
  const otherCount = await others.count();
  test.skip(
    otherCount === 0,
    "공유 운영 DB가 단일 팀 — 전환 대상이 없어 다중 팀 전환 검증을 건너뜀(유닛이 격리 커버)",
  );

  // 다른 팀으로 전환 → 현재 팀 이름이 바뀌고(전환 성공), 대시보드가 에러 없이 다시 그려진다.
  const targetName = (await others.first().innerText()).trim();
  await others.first().click();
  await expect(region.locator("p[title]")).toHaveText(targetName);
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴" }),
  ).toBeVisible();
  await expect(page.getByText("불러오지 못했어요")).toHaveCount(0);

  // 원래 팀으로 되돌려 활성 팀 쿠키를 복구한다(비파괴 — 다음 실행/테스트에 영향 없음).
  await page
    .getByRole("list", { name: "다른 팀" })
    .getByRole("button", { name: originalName })
    .click();
  await expect(region.locator("p[title]")).toHaveText(originalName);
});

// ③ 다른 팀/존재하지 않는 논문 단건 진입 → "찾을 수 없음"(404 등가, R19).
//    교차 팀과 부재는 같은 null 결과로 수렴한다(getPaperDetail findFirst{id,teamId} → null) — 존재 비노출.
//    실제 다른 팀의 논문 id를 알 필요 없이, 활성 팀에 없는 id면 동일 경로를 탄다.
test('활성 팀에 없는 논문 단건 진입은 "찾을 수 없음"(404 등가)을 보이고 PDF 라우트도 404다', async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL },
  });
  expect(login.ok()).toBeTruthy();

  // 활성 팀에 속하지 않는(존재하지 않는) 논문 id로 단건 진입.
  await page.goto("/papers/cross-team-or-missing-xyz");
  await expect(page.getByText("논문을 찾을 수 없어요.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "논문 목록으로" }),
  ).toBeVisible();

  // PDF 다운로드 라우트도 활성 팀 스코핑으로 404(서명 URL 비노출, R36/R19).
  const pdf = await page.request.get(
    "/api/papers/cross-team-or-missing-xyz/pdf",
    { maxRedirects: 0 },
  );
  expect(pdf.status()).toBe(404);
});

// ④ 라이브는 활성 팀 기준 빈 상태 — 진행 중 세션이 없으면 빈 상태 + 사이드바 LIVE 알약 없음.
//    라이브는 step4에서 팀당 1개로 스코핑됐다(getActiveSession(teamId)). 시작 게이팅은 meeting.spec이
//    503 친절 안내를 별도 검증한다 — 여기선 활성 팀 컨텍스트의 정직한 빈 상태만 단언(비파괴).
test("활성 팀에 진행 중 라이브가 없으면 빈 상태이고 사이드바에 LIVE 알약이 없다", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/meeting");

  // 활성 팀 기준 빈 상태(R21/R26 빈) — 시드에 active 세션 없음.
  await expect(page.getByText(/아직 진행 중인 세미나가 없어요/)).toBeVisible();

  // 전역 live=false(활성 팀 기준, ADR-001/R37) — 사이드바 LIVE 알약(aria-label)이 없다.
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴" }),
  ).toBeVisible();
  await expect(page.getByLabel("진행 중인 라이브")).toHaveCount(0);

  // 시작 CTA는 노출·활성(키 없이 도달 가능한 빈 상태 경로). 실제 시작(503)은 meeting.spec이 검증.
  const start = page.getByRole("button", { name: /라이브 시작/ });
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
});
