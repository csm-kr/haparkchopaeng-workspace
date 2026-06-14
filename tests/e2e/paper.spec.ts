import { expect, test } from "@playwright/test";

// F3. 논문 분석 읽기·노트 작성 — 헤드리스 비파괴 QA.
// 공유 운영 DB라 논문 수·분석 상태가 가변 → 논문이 있으면 검증, 없으면 런타임 skip(실패 아님).
// 노트는 폼을 열고 [취소]까지만(공유 DB에 노트를 영구 생성하지 않는다 — [추가] 금지).
// 관점 토글·Figure·노트 폼은 analysisStatus="ready"일 때만 렌더되므로(AnalysisStatusBlock 분기)
// 분석 대기/실패 논문에서도 실패하지 않도록 ready 여부로 분기한다.
test("논문 상세 — 관점 토글·Figure 공통·노트 폼(논문 유무 조건부)", async ({
  page,
}) => {
  // 1) dev 로그인 — 단일 관리자 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 논문 목록 진입 → 행 또는 빈 상태가 보인다(데이터 수 무관).
  await page.goto("/library");
  const rows = page.locator("a.paper-row");
  await expect(
    rows.first().or(page.getByText("아직 올라온 논문이 없어요")),
  ).toBeVisible();

  // 논문이 없으면 상세 검증 대상이 없다 → 런타임 skip(테스트 실패가 아니다).
  const count = await rows.count();
  test.skip(count === 0, "공유 DB에 논문이 없어 상세 검증 보류");

  // 3) 첫 논문 → 상세 진입.
  await rows.first().click();
  await expect(page).toHaveURL(/\/papers\/.+/);
  await expect(page.locator("h1").first()).toBeVisible();

  // 상세 렌더 확인: 관점 토글(ready) 또는 분석 상태 블록(pending/failed) 중 하나가 보인다.
  const lensGroup = page.getByRole("group", { name: "분석 관점" });
  const statusBlock = page.getByText(/논문을 읽고 있어요|분석을 못 끝냈어요/);
  await expect(lensGroup.or(statusBlock)).toBeVisible();

  // 분석이 ready가 아니면(대기/실패) 토글·Figure·노트 폼이 없다 → 상태 블록만 확인하고 종료.
  if (!(await lensGroup.isVisible())) {
    await expect(statusBlock).toBeVisible();
    return;
  }

  // 4) 관점 토글 검증 — 두 관점뿐(R10). 재구현으로 토글하면 재구현 섹션, 다시 연구로.
  const researchBtn = page.getByRole("button", { name: /연구 분석/ });
  const reproBtn = page.getByRole("button", { name: /재구현 분석/ });
  await expect(researchBtn).toBeVisible();
  await expect(reproBtn).toBeVisible();

  await reproBtn.click();
  await expect(reproBtn).toHaveAttribute("aria-pressed", "true");
  // 재구현 섹션(데이터·모델·학습·리소스) 또는 빈 payload 안내 — 데이터 무관.
  await expect(
    page
      .getByRole("heading", { name: /데이터|모델|학습|리소스/ })
      .first()
      .or(page.getByText("이 관점 분석이 아직 없어요")),
  ).toBeVisible();

  await researchBtn.click();
  await expect(researchBtn).toHaveAttribute("aria-pressed", "true");
  // 연구 섹션(Problem/Contribution 등) 또는 빈 payload 안내 — 데이터 무관.
  await expect(
    page
      .getByRole("heading", { name: /Problem Setting|Contribution/ })
      .first()
      .or(page.getByText("이 관점 분석이 아직 없어요")),
  ).toBeVisible();

  // 5) Figure 공통 노출(ADR-005, lens:any) — 두 관점 하단 고정. 헤더는 figure 유무와 무관하게 항상 존재.
  await expect(
    page.getByRole("heading", { name: "Figure 분석" }),
  ).toBeVisible();

  // 6) 섹션 노트 폼(비파괴): [+ 이 섹션에 분석 추가] → 인라인 폼 → [취소] → 폼 닫힘. [추가] 금지.
  await page
    .getByRole("button", { name: /섹션에 분석 추가/ })
    .first()
    .click();
  const noteTitle = page.getByLabel("노트 제목");
  await expect(noteTitle).toBeVisible();
  await expect(page.getByLabel("노트 내용")).toBeVisible();

  await page.getByRole("button", { name: "취소" }).first().click();
  await expect(noteTitle).toBeHidden();
});
