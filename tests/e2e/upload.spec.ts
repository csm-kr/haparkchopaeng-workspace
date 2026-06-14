import { expect, test } from "@playwright/test";

// 핵심 경로 1개: dev 로그인 → ＋업로드 모달 열기 → arXiv 입력 필드 확인 →
// 비-PDF 거부(인라인 에러). 실제 Storage 업로드는 E2E에서 수행하지 않는다(UI/검증까지).
test("업로드 모달은 PDF 전용 + arXiv 입력이며 비-PDF를 거부한다", async ({
  page,
}) => {
  // 1) dev 로그인 — 시드 멤버(하수현) 이메일로 세션 쿠키 확보.
  const login = await page.request.post("/api/auth/login", {
    data: { email: "de8167@gmail.com" },
  });
  expect(login.ok()).toBeTruthy();

  // 2) 홈 진입 후 헤더의 ＋업로드 열기.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /업로드/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // 3) arXiv 주소 입력 필드(드래그앤드롭 또는 arXiv URL — ADR-003).
  await expect(page.getByLabel("arXiv 주소")).toBeVisible();

  // 4) 비-PDF 파일은 인라인 에러로 거부.
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "slides.pptx",
    mimeType: "application/vnd.ms-powerpoint",
    buffer: Buffer.from("not a pdf"),
  });
  await expect(page.getByText("PDF만 올릴 수 있어요.")).toBeVisible();
});
