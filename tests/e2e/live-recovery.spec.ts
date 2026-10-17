import { expect, test, type Page } from "@playwright/test";
import { AccessToken } from "livekit-server-sdk";
import { prisma } from "../../lib/prisma";
import { createLiveSession } from "../../lib/live";
import { assertTestDatabase } from "../../scripts/test-database";

assertTestDatabase();
// 실제 Next 화면·인증·조회·종료 API + 격리 PostgreSQL을 사용한다.
// SFU 입장 토큰/시작 응답만 가짜 전송 계층으로 대체한다(실제 카메라·외부 SFU 없음).
test.describe.configure({ mode: "serial" });
const teams: Array<{ id: string; slug: string }> = [];
const viewerId = "live-recovery-viewer";
const viewerEmail = "live-recovery@example.test";

test.beforeAll(async () => {
  await prisma.member.create({ data: {
    id: viewerId, email: viewerEmail, handle: "@live-recovery", name: "복구 검증", role: "멤버", color: "var(--m-ha)", initial: "복",
  } });
  for (const slug of ["live-recovery-a", "live-recovery-b"]) {
    const team = await prisma.team.create({ data: {
      slug, name: slug, createdBy: "jo",
      memberships: { create: [{ memberId: "jo", role: "owner" }, { memberId: viewerId, role: "member" }] },
    } });
    teams.push(team);
  }
});
test.afterEach(async () => {
  await prisma.liveSession.updateMany({ where: { teamId: { in: teams.map((t) => t.id) } }, data: { active: false } });
});
test.afterAll(async () => {
  const ids = teams.map((t) => t.id);
  await prisma.liveSession.deleteMany({ where: { teamId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { teamId: { in: ids } } });
  await prisma.team.deleteMany({ where: { id: { in: ids } } });
  await prisma.member.deleteMany({ where: { id: viewerId } });
  await prisma.$disconnect();
});

async function token(id: string, identity: string) {
  const jwt = new AccessToken("test-key", "test-secret-for-local-browser-only", { identity });
  jwt.addGrant({ roomJoin: true, room: `live-${id}` });
  return jwt.toJwt();
}

async function openMeeting(page: Page, teamIndex = 0, viewer = false) {
  const team = teams[teamIndex];
  const login = await page.request.post("/api/auth/login", { data: { email: viewer ? viewerEmail : "de8167@gmail.com" } });
  expect(login.ok()).toBeTruthy();
  expect((await page.request.post("/api/teams/active", { data: { slug: team.slug } })).ok()).toBeTruthy();
  await page.route("**/api/live/start", async (route) => {
    const session = await createLiveSession(team.id, "jo");
    await route.fulfill({ status: 201, json: { data: { session, token: await token(session.id, "jo"), url: "ws://127.0.0.1:9" } } });
  });
  await page.route("**/api/live/*/join", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    await route.fulfill({ json: { data: { token: await token(id, viewer ? viewerId : "jo"), url: "ws://127.0.0.1:9" } } });
  });
  await page.goto("/meeting");
}

async function start(page: Page) {
  await page.getByRole("button", { name: "라이브 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "라이브 종료", exact: true })).toBeVisible();
  const response = await page.request.get("/api/live");
  return (await response.json()).data.id as string;
}
async function end(page: Page) {
  await page.getByRole("button", { name: "라이브 종료", exact: true }).click();
  await page.getByRole("button", { name: "종료할게요", exact: true }).click();
}

test("이전 종료 응답이 지연되어도 즉시 재시작한 라이브를 유지한다", async ({ page }) => {
  await openMeeting(page);
  const first = await start(page);
  let release!: () => void;
  let stored!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const committed = new Promise<void>((resolve) => { stored = resolve; });
  await page.route(`**/api/live/${first}/end`, async (route) => {
    const response = await route.fetch(); // 실제 종료 API가 DB에 먼저 반영한다.
    stored();
    await held;
    await route.fulfill({ response });
  });
  try {
    await end(page);
    await committed;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const second = await start(page);
    expect(second).not.toBe(first);
    const oldResponse = page.waitForResponse((r) => r.url().endsWith(`/${first}/end`));
    release();
    await oldResponse;
    await expect(page.getByRole("button", { name: "라이브 종료", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "라이브 시작", exact: true })).toHaveCount(0);
    expect((await (await page.request.get("/api/live")).json()).data.id).toBe(second);
  } finally { release(); }
});

test("오프라인 동안 종료·재시작된 라이브로 연결 복귀 시 다시 입장한다", async ({ page, browser }) => {
  await openMeeting(page);
  const first = await start(page);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const viewer = await context.newPage();
  try {
    const firstJoin = viewer.waitForRequest((r) => r.url().endsWith(`/${first}/join`));
    await openMeeting(viewer, 0, true);
    await firstJoin;
    await expect(viewer.getByRole("button", { name: "나가기", exact: true })).toBeVisible();
    await context.setOffline(true);
    await end(page);
    const second = await start(page);
    const secondJoin = viewer.waitForRequest((r) => r.url().endsWith(`/${second}/join`));

    await context.setOffline(false);

    await secondJoin;
    await expect(viewer.getByRole("button", { name: "나가기", exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test("두 팀이 동시에 사용해도 다른 팀 종료는 현재 팀 라이브를 유지한다", async ({ page, browser }) => {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const other = await context.newPage();
  try {
    await openMeeting(page, 0);
    await openMeeting(other, 1);
    const first = await start(page);
    await start(other);

    await end(other);
    await expect(other.getByRole("button", { name: "라이브 시작", exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    await expect(page.getByRole("button", { name: "라이브 종료", exact: true })).toBeVisible();
    expect((await (await page.request.get("/api/live")).json()).data.id).toBe(first);
  } finally { await context.close(); }
});
