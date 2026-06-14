import { expect, test } from "@playwright/test";

// F6 팀 관리(관리자) 비파괴 QA — DB는 공유 운영 Supabase다. 초대 전송/역할 변경/내보내기를
// 실제로 실행하지 않는다(실제 이메일 발송·멤버 변경 발생). 폼·메뉴·확인 다이얼로그는 열고 검증까지만.
// 로그인: de8167@gmail.com = 단일 관리자(ADR-017 dev 로그인). step0이 webServer를 dev로 고쳐 둠.

// 핵심 경로: dev 로그인(관리자=조성민) → /team → 단일 관리자 본인 + 초대 전용 안내 렌더.
// (멤버는 관리자가 초대해 늘린다 — 초기엔 본인 1명.)
// NOTE: 이메일 초대 폼은 멀티팀 전환(ADR-018, phase 6 step 2)으로 제거됐고, 토큰 초대 발급 UI는
//       step 4(team-ui)에서 채운다 — 여기선 헤더·안내까지만 단언한다.
test("관리자로 팀 관리에 들어가면 본인 멤버와 초대 안내가 보인다", async ({
  page,
}) => {
  // 1) dev 로그인 — 단일 관리자(조성민) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 팀 관리 진입.
  await page.goto("/team");

  // 3) 본인(조성민) — 이메일은 팀 화면에만 노출되어 유일하게 식별된다.
  await expect(page.getByText("de8167@gmail.com")).toBeVisible();
  await expect(page.getByText("나").first()).toBeVisible();

  // 4) 팀 관리 헤더 + 초대 전용 안내(현재 UI). 토큰 초대 발급 UI는 step 4 소관 — 여기선 단언하지 않는다.
  await expect(page.getByRole("heading", { name: "팀 관리" })).toBeVisible();
  await expect(
    page.getByText("초대 전용 비공개 그룹이에요. 합류는 초대 링크로만 가능해요."),
  ).toBeVisible();

  // 5) 권한 안내(R19): 관리자 시점에선 비관리자용 안내 카드가 뜨지 않는다(비관리자에게만 안내).
  await expect(
    page.getByText("멤버 초대·역할 변경은 관리자만 할 수 있어요."),
  ).toHaveCount(0);
});

// F6: 멤버 ⋯ 메뉴(역할 변경/내보내기) + 내보내기 확인 다이얼로그를 "노출까지만" 검증한다.
// CRITICAL: ⋯ 관리 메뉴는 관리자 본인 행엔 없다(team-manager: isAdmin && !isSelf) —
//   자기 권한 박탈·잠금 방지. 따라서 본인 외 멤버가 있어야 검증 가능하다. 공유 DB가
//   단일 관리자(타 멤버 0)면 검증 대상이 없으므로 런타임 skip(데이터 무관 — step4/5와 동일 패턴).
test("관리자는 다른 멤버의 ⋯ 메뉴와 내보내기 확인 다이얼로그를 볼 수 있다(실행 금지)", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/team");

  // 본인 외 멤버 행에만 ⋯ 관리 메뉴가 붙는다(aria-label "{이름} 관리 메뉴").
  const menuButtons = page.getByRole("button", { name: /관리 메뉴$/ });
  const manageable = await menuButtons.count();
  test.skip(
    manageable === 0,
    "단일 관리자 워크스페이스 — 관리 대상(본인 외 멤버)이 없어 ⋯ 메뉴 검증을 건너뜀",
  );

  // 1) 첫 멤버의 ⋯ 메뉴 열기 → 역할 변경 / 내보내기 액션이 보인다.
  await menuButtons.first().click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("역할 변경")).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "내보내기" }),
  ).toBeVisible();

  // 2) [내보내기] → 확인 다이얼로그가 뜬다. 확인(실행)은 누르지 않는다(R27, 파괴적).
  await menu.getByRole("menuitem", { name: "내보내기" }).click();
  const dialog = page.getByRole("dialog", { name: "멤버 내보내기 확인" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/님을 내보낼까요\?/)).toBeVisible();

  // 3) 위험(내보내기) 버튼은 누르지 않고 [취소]로 빠져나온다 — 멤버 제거·이메일 발송 방지.
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();
});
