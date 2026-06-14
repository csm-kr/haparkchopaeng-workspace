import { expect, test } from "@playwright/test";

// 핵심 경로: dev 로그인 → /presentations → 정상 렌더.
// 운영 공유 DB라 발표 수는 가변 — 항목(행) 또는 빈 상태 중 하나가 보이면 통과.
// (상세 뷰어·회고 댓글 검증은 실제 발표 자료 고정 시드가 생기면 추후.)
test("로그인 후 발표 자료 목록이 정상 렌더된다(목록 또는 빈 상태)", async ({
  page,
}) => {
  // 1) dev 로그인 — 단일 관리자(조성민) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 발표 자료 목록 진입 → 항목 또는 빈 상태가 보인다.
  await page.goto("/presentations");
  await expect(
    page
      .locator("a.presentation-row")
      .first()
      .or(page.getByText("발표 자료가 아직 없어요")),
  ).toBeVisible();
});

// F5. 발표 자료 회고 — 헤드리스 비파괴 QA(데이터 무관 조건부).
// 공유 운영 DB라 발표 수가 가변 → 자료가 있으면 상세 검증, 없으면 런타임 skip(실패 아님).
// CRITICAL: 댓글을 실제로 전송하지 않는다(공유 DB에 댓글 영구 생성 방지) — textarea 입력값 반영까지만.
test("발표 자료 상세 — 뷰어·회고 댓글 입력(자료 유무 조건부)", async ({
  page,
}) => {
  // 1) dev 로그인 — 단일 관리자(조성민) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 목록 진입 → 행 또는 빈 상태가 보인다(데이터 수 무관, 안정화 대기).
  await page.goto("/presentations");
  const rows = page.locator("a.presentation-row");
  await expect(
    rows.first().or(page.getByText("발표 자료가 아직 없어요")),
  ).toBeVisible();

  // 발표 자료가 없으면 상세 검증 대상이 없다 → 런타임 skip(테스트 실패가 아니다).
  const count = await rows.count();
  test.skip(count === 0, "공유 DB에 발표 자료가 없어 상세 검증 보류");

  // 3) 첫 발표 자료 → 상세 진입.
  await rows.first().click();
  await expect(page).toHaveURL(/\/presentations\/.+/);

  // 자료 뷰어 영역: 상세 헤더 제목(h1)이 보인다(상세 진입 확정).
  await expect(page.locator("h1").first()).toBeVisible();

  // 4) 회고 댓글 스레드 + 입력 textarea 노출(ADR-004: 댓글은 발표 자료 귀속).
  await expect(
    page.getByRole("region", { name: "회고 댓글" }),
  ).toBeVisible();
  const commentBox = page.getByLabel("댓글 내용");
  await expect(commentBox).toBeVisible();

  // 5) 입력만 한다 — 전송(Cmd/Ctrl+Enter·[보내기]) 금지. 입력값 반영까지만 단언.
  await commentBox.fill("리뷰 테스트");
  await expect(commentBox).toHaveValue("리뷰 테스트");
});
