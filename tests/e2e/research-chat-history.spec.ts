import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/prisma";
import { assertTestDatabase } from "../../scripts/test-database";

assertTestDatabase();
// 실제 Next 화면·대화 API·격리 PostgreSQL. 대화가 화면보다 많을 때의 목록과 삭제를 확인한다.
test.describe.configure({ mode: "serial" });
const memberId = "chat-history-viewer", email = "chat-history@example.test";
let teamId = "";

test.beforeEach(async () => {
  await prisma.member.upsert({ where: { id: memberId }, create: { id: memberId, email, handle: "@chat-history", name: "대화 기록", role: "멤버", color: "var(--m-ha)", initial: "대" }, update: {} });
  const team = await prisma.team.upsert({ where: { slug: "chat-history" }, create: { slug: "chat-history", name: "chat-history", createdBy: "jo", memberships: { create: [{ memberId: "jo", role: "owner" }, { memberId, role: "member" }] } }, update: {} });
  teamId = team.id;
  await prisma.researchConversation.deleteMany({ where: { memberId } });
  for (let index = 0; index < 60; index += 1) {
    const title = index % 7 === 3 ? `https://arxiv.org/abs/2410.${String(index).padStart(5, "0")}UnbrokenTitleWithoutSpaces${index}` : `대화 ${index} 트랜스포머 어텐션과 확산 모델의 학습 안정성 비교`;
    await prisma.researchConversation.create({ data: { teamId, memberId, title, paperIds: [], updatedAt: new Date(Date.now() - index * 60_000) } });
  }
});
test.afterAll(async () => {
  await prisma.researchConversation.deleteMany({ where: { memberId } });
  await prisma.team.deleteMany({ where: { id: teamId } });
  await prisma.member.deleteMany({ where: { id: memberId } });
});

async function open(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: { email } })).ok()).toBeTruthy();
  await page.goto("/ai-chat");
}
async function expectReadableRows(page: Page) {
  const list = page.getByRole("navigation", { name: "내 AI 대화" });
  await expect(list.getByText("대화 0 트랜스포머", { exact: false })).toBeVisible({ timeout: 60_000 });
  const heights = await list.locator("button[type=button] > span").evaluateAll(spans => spans.slice(0, 20).map(span => span.getBoundingClientRect().height));
  expect(heights.length).toBe(20);
  for (const height of heights) expect(height).toBeGreaterThan(12);
  expect(await list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
}

test("대화가 화면보다 많아도 목록 제목이 눌리지 않고 스크롤된다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await expectReadableRows(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("모바일 대화 목록 창도 제목을 그대로 보여 준다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: "대화 목록 열기" }).click();
  await expectReadableRows(page);
});

test("점 3개 메뉴로 대화를 지우면 새로고침 뒤에도 목록에서 사라진다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const list = page.getByRole("navigation", { name: "내 AI 대화" });
  const title = "대화 1 트랜스포머 어텐션과 확산 모델의 학습 안정성 비교";
  await expect(list.getByText(title)).toBeVisible({ timeout: 60_000 });
  await list.getByText(title).hover();
  await page.getByRole("button", { name: `${title} 더보기` }).click();
  await page.getByRole("menuitem", { name: "삭제" }).click();
  await expect(page.getByText(`「${title}」 대화를 삭제할까요?`, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(list.getByText(title)).toHaveCount(0);
  await page.reload();
  await expect(list.getByText("대화 0 트랜스포머", { exact: false })).toBeVisible({ timeout: 60_000 });
  await expect(list.getByText(title)).toHaveCount(0);
  expect(await prisma.researchConversation.count({ where: { memberId } })).toBe(59);
});
