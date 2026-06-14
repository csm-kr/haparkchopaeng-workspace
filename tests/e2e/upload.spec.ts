import { expect, test } from "@playwright/test";

// F2(논문 업로드 → 분석)의 입력·검증 분기와 주간 분석 한도 표시를 비파괴로 QA한다.
// CRITICAL: 실제 업로드/arXiv 가져오기를 끝까지 실행하지 않는다 — 공유 운영 DB에 Paper가 생기고
//   분석 잡(Inngest+Gemini)이 돌아 비용·오염이 발생한다. 검증/인라인 에러까지만 단언한다.

// 핵심 경로 1개: dev 로그인 → ＋업로드 모달 열기 → PDF 전용 + arXiv 입력 확인 →
// 주간 분석 한도 표시 → 비-PDF 거부(인라인 에러). 실제 Storage 업로드는 수행하지 않는다(UI/검증까지).
test("업로드 모달은 PDF 전용 + arXiv 입력이며 한도를 표시하고 비-PDF를 거부한다", async ({
  page,
}) => {
  // dev 로그인 — 시드 멤버 이메일로 세션 쿠키 확보. page.request는 쿠키 저장소를 공유한다.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 홈 진입 후 헤더의 ＋업로드 열기.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "논문 올리기" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // ① PDF 전용 + arXiv 입력(ADR-003). arXiv 주소 입력과 PDF 파일 선택 어포던스가 보인다.
  await expect(page.getByLabel("arXiv 주소")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "파일 선택", exact: true }),
  ).toBeVisible();

  // ② 주간 분석 한도 표시(phase-4 step1). 수치는 데이터 가변이라 정규식으로 데이터-무관하게 단언.
  await expect(page.getByText(/이번 주 분석 \d+\/\d+/)).toBeVisible();

  // ③ 비-PDF 파일은 인라인 에러로 거부(모달 유지). 업로드 시도 자체를 막는다(R12/R30).
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "slides.pptx",
    mimeType: "application/vnd.ms-powerpoint",
    buffer: Buffer.from("not a pdf"),
  });
  await expect(page.getByText("PDF만 올릴 수 있어요.")).toBeVisible();
  await expect(dialog).toBeVisible();
});

// arXiv URL 오류 분기: 잘못된 주소는 인라인 에러로 거부되고 모달은 유지된다.
// CRITICAL: 비-arxiv 호스트(example.com)는 서버 parseArxivId 화이트리스트에서 null →
//   POST /api/papers가 fetch/Paper 생성 전에 400으로 거부한다(arxiv.org 호출도 없음). 비파괴.
test("잘못된 arXiv 주소는 인라인 에러로 거부되고 모달은 유지된다", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "논문 올리기" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // 잘못된(비-arxiv) 주소 입력 → [가져오기]. 서버가 생성까지 가지 않고 400으로 거부.
  await page.getByLabel("arXiv 주소").fill("https://example.com/not-arxiv");
  await page.getByRole("button", { name: "가져오기" }).click();

  // 인라인 에러(role=alert, 토스트 아님)로 안내되고 모달은 유지된다.
  const alert = dialog.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("arXiv 주소를 확인해주세요.");
  await expect(dialog).toBeVisible();
});
