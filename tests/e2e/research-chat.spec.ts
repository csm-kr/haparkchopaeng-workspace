import { expect, test, type Page } from "@playwright/test";
import type { LocalAgentDeviceView } from "../../types/local-agent";
import type { ResearchChatTurn, ResearchConversationView, ResearchPaperOption, ResearchPresentationOption } from "../../types/research-chat";

// UI fixtures only. The separate service integration tests cover actual queue/ownership.
const papers: ResearchPaperOption[] = ["A", "B", "C", "D"].map((letter, index) => ({ id: `chat-fixture-${index}`, title: `연구 논문 ${letter}`, sourceReady: index !== 2 }));
const presentations: ResearchPresentationOption[] = [{ id: "seminar", title: "토요일 세미나", date: "2026-10-17T00:00:00Z" }];
const now = new Date().toISOString();
const device: LocalAgentDeviceView = { id: "chat-fixture-pc", name: "연구용 PC", platform: "windows", online: true, lastSeenAt: now, leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(), providers: [{ provider: "codex", status: "ready", models: [{ id: "fixture-model", name: "감지된 연구 모델", reasoningEfforts: ["low", "medium", "high"] }, { id: "second-model", name: "다른 연구 모델", reasoningEfforts: ["low", "medium", "high"] }], quota: null, observedAt: now }] };

async function setup(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: { email: "de8167@gmail.com" } })).ok()).toBeTruthy();
  await page.addInitScript(() => Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false } }));
  let conversation: ResearchConversationView | null = null;
  const turns: ResearchChatTurn[] = [];
  let creates = 0, sends = 0, cancelled = false, expired = false;
  let lastInput: Record<string, unknown> | null = null;
  await page.route("**/api/local-agent/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/status") ? { device, devices: [device], leaseDurationSeconds: 45, heartbeatIntervalSeconds: 15 } : path.endsWith("/web-heartbeat") ? { leaseExpiresAt: device.leaseExpiresAt } : path.endsWith("/downloads") ? { releases: [] } : null;
    await route.fulfill({ status: data ? 200 : 404, json: data ? { data } : { error: { code: "NOT_FOUND" } } });
  });
  await page.route("**/api/research-chat/**", async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (expired) { await route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "로그인이 필요해요." } } }); return; }
    let data: unknown;
    if (path.endsWith("/papers")) data = papers;
    else if (path.endsWith("/presentations")) data = presentations;
    else if (path.endsWith("/conversations") && method === "GET") data = conversation ? [conversation] : [];
    else if (path.endsWith("/conversations") && method === "POST") {
      creates += 1;
      const body = route.request().postDataJSON();
      conversation = { id: "chat-fixture-conversation", title: body.title, paperIds: body.paperIds ?? [], presentationIds: body.presentationIds ?? [], createdAt: now, updatedAt: now }; data = conversation;
    } else if (path.endsWith("/turns") && method === "POST" && conversation) {
      sends += 1;
      const body = route.request().postDataJSON(); lastInput = body;
      conversation = { ...conversation, paperIds: body.paperIds, presentationIds: body.presentationIds };
      cancelled = false;
      const materials = [...papers.filter(paper => body.paperIds?.includes(paper.id)).map(paper => ({ kind: "paper" as const, id: paper.id, title: paper.title })),
        ...presentations.filter(item => body.presentationIds?.includes(item.id)).map(item => ({ kind: "presentation" as const, id: item.id, title: item.title }))];
      const turn: ResearchChatTurn = { id: `chat-fixture-turn-${sends}`, version: 1, conversationId: conversation.id, conversationTurn: sends, canCancel: true, contextTruncated: true, paperId: conversation.paperIds[0] ?? "", provider: body.provider, model: body.model, effort: body.effort, prompt: body.prompt, materials, status: "queued", response: "", error: null, createdAt: now, updatedAt: now };
      turns.push(turn); data = turn;
    } else if (path.endsWith("/cancel") && turns.length) { cancelled = true; const turn = turns.at(-1)!; turns[turns.length - 1] = { ...turn, version: turn.version + 1, status: "cancelled", canCancel: false, response: "함께 생각한 부분 답변", error: null }; data = turns.at(-1); }
    else if (conversation && path.endsWith(`/conversations/${conversation.id}`)) {
      const turn = turns.at(-1);
      if (turn && !cancelled && ["queued", "running"].includes(turn.status)) turns[turns.length - 1] = { ...turn, version: 2, status: "running", response: "함께 생각한 부분 답변" };
      data = { conversation, papers: papers.filter(paper => conversation!.paperIds.includes(paper.id)), presentations: presentations.filter(item => conversation!.presentationIds?.includes(item.id)), turns, hasEarlierTurns: false };
    } else { await route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }); return; }
    await route.fulfill({ status: 200, json: { data } });
  });
  return { creates: () => creates, sends: () => sends, lastInput: () => lastInput, expire: () => { expired = true; },
    complete: (response: string) => { const turn = turns.at(-1); if (!turn) throw new Error("완료할 테스트 질문이 없어요."); turns[turns.length - 1] = { ...turn, version: turn.version + 1, status: "completed", canCancel: false, response }; } };
}

async function addMaterial(page: Page, title: string) {
  await page.getByRole("button", { name: "자료 추가", exact: true }).click();
  const input = page.getByRole("textbox", { name: "연구 질문" });
  await input.fill(`@${title}`);
  await page.getByRole("option", { name: new RegExp(title) }).click();
}

test("자료나 모델 선택 단계 없이 대화하고 부분 답변·중지·이력을 유지한다", async ({ page }) => {
  const fixture = await setup(page); await page.goto("/ai-chat");
  const input = page.getByRole("textbox", { name: "연구 질문" });
  await expect(page.getByRole("link", { name: "AI 채팅", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("사용할 모델", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "논문 요약", exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("free-chat-desktop.png") });
  await input.fill("함께 새로운 연구 아이디어를 생각해 보자.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page).toHaveURL(/\/ai-chat\/chat-fixture-conversation$/);
  await expect(page.getByText("함께 생각한 부분 답변", { exact: true })).toBeVisible();
  await expect(page.getByText(/분량 제한으로/)).toBeVisible();
  expect(fixture.lastInput()).toMatchObject({ model: "fixture-model", effort: "medium", paperIds: [], presentationIds: [] });
  await page.getByRole("button", { name: "답변 중지", exact: true }).click();
  await expect(page.getByText("답변을 중지했어요.")).toBeVisible();
  expect(fixture.creates()).toBe(1); expect(fixture.sends()).toBe(1);
  await page.getByRole("button", { name: "새 대화", exact: true }).click();
  await expect(page.getByRole("heading", { name: "무엇을 함께 생각해 볼까요?" })).toBeVisible();
  if (await page.getByRole("button", { name: "대화 목록 열기" }).isVisible()) await page.getByRole("button", { name: "대화 목록 열기" }).click();
  await page.getByRole("button", { name: /^함께 새로운 연구 아이디어(?!.*더보기)/ }).click();
  await expect(page.getByText("함께 생각한 부분 답변", { exact: true })).toBeVisible();
  expect(fixture.sends()).toBe(1);
});

test("계정 위 연결 설정에서 모델·effort를 고르고 @로 논문과 세미나를 부른다", async ({ page }) => {
  const fixture = await setup(page); await page.goto("/ai-chat");
  const settings = page.getByRole("button", { name: "AI 연결", exact: true });
  const account = page.locator('a[href="/profile"]').last();
  expect((await settings.boundingBox())!.y).toBeLessThan((await account.boundingBox())!.y);
  await settings.click();
  const dialog = page.getByRole("dialog", { name: "AI 연결", exact: true });
  await dialog.getByRole("combobox", { name: "모델" }).selectOption("codex:second-model");
  await dialog.getByRole("radio", { name: "high", exact: true }).check();
  await dialog.screenshot({ path: test.info().outputPath("connection-settings.png") });
  await page.keyboard.press("Escape"); await expect(settings).toBeFocused();
  await addMaterial(page, "연구 논문 A"); await addMaterial(page, "토요일 세미나");
  await page.getByRole("textbox", { name: "연구 질문" }).fill("두 자료의 가정을 비교해줘.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect.poll(() => fixture.sends()).toBe(1);
  expect(fixture.lastInput()).toMatchObject({ model: "second-model", effort: "high", paperIds: [papers[0].id], presentationIds: ["seminar"] });
});

test("자료 추가·선택 뒤 늦은 프레임이 사용자의 전체 선택을 덮지 않는다", async ({ page }) => {
  await setup(page); await page.goto("/ai-chat");
  const settings = page.getByRole("button", { name: "AI 연결", exact: true });
  await settings.click(); await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();
  const input = page.getByRole("textbox", { name: "연구 질문" });
  const holdFrames = () => page.evaluateHandle(() => {
    const original = window.requestAnimationFrame;
    const callbacks: FrameRequestCallback[] = [];
    window.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
    return { flush() { window.requestAnimationFrame = original; for (const callback of callbacks.splice(0)) callback(performance.now()); } };
  });

  const adding = await holdFrames();
  await page.getByRole("button", { name: "자료 추가", exact: true }).click();
  await input.selectText();
  await adding.evaluate(frames => frames.flush());
  await page.keyboard.insertText(`@${papers[0].title}`);
  expect(await input.inputValue()).toBe(`@${papers[0].title}`);
  await expect(page.getByRole("option", { name: /연구 논문 A/ })).toBeVisible();

  const choosing = await holdFrames();
  await page.getByRole("option", { name: /연구 논문 A/ }).click();
  await input.fill("바꿀 초안");
  await input.selectText();
  await choosing.evaluate(frames => frames.flush());
  await page.keyboard.insertText("최종 질문");
  expect(await input.inputValue()).toBe("최종 질문");
  await expect(page.getByRole("button", { name: `${papers[0].title} 선택 해제`, exact: true })).toBeVisible();
  await adding.dispose(); await choosing.dispose();
});

test("자료를 비운 후속 질문도 같은 대화에 이어지고 이전 턴의 자료·답변을 보존한다", async ({ page }) => {
  const fixture = await setup(page); await page.goto("/ai-chat");
  await addMaterial(page, papers[0].title);
  const input = page.getByRole("textbox", { name: "연구 질문" });
  await input.fill("첫 자료의 가정을 정리해줘.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("article", { name: "질문 1", exact: true })).toBeVisible();
  fixture.complete("첫 자료의 가정을 정리한 답변");
  await expect(page.getByText("첫 자료의 가정을 정리한 답변", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `${papers[0].title} 선택 해제`, exact: true }).click();
  await input.fill("그 가정에서 이어지는 실험을 제안해줘.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("article", { name: "질문 2", exact: true })).toBeVisible();
  expect(fixture.lastInput()).toMatchObject({ paperIds: [], presentationIds: [], prompt: "그 가정에서 이어지는 실험을 제안해줘." });
  fixture.complete("앞선 답변에 이어서 제안한 실험");
  await expect(page.getByText("앞선 답변에 이어서 제안한 실험", { exact: true })).toBeVisible();
  const first = page.getByRole("article", { name: "질문 1", exact: true });
  await expect(first.getByRole("link", { name: `@${papers[0].title}`, exact: true })).toHaveAttribute("href", `/papers/${papers[0].id}`);
  await expect(first.getByText("첫 자료의 가정을 정리한 답변", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "새 대화", exact: true }).click();
  if (await page.getByRole("button", { name: "대화 목록 열기" }).isVisible()) await page.getByRole("button", { name: "대화 목록 열기" }).click();
  await page.getByRole("button", { name: /^첫 자료의 가정을 정리해줘(?!.*더보기)/ }).click();
  await expect(page.getByRole("article", { name: "질문 1", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "질문 2", exact: true })).toBeVisible();
  await expect(page.getByText("앞선 답변에 이어서 제안한 실험", { exact: true })).toBeVisible();
  expect(fixture.creates()).toBe(1); expect(fixture.sends()).toBe(2);
});

test("390px에서도 @ 자료 검색·설정·입력이 잘리지 않고 모달 포커스를 돌려준다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page); await page.goto("/ai-chat");
  await expect(page.getByRole("button", { name: "사이드바 펼치기" })).toBeVisible();
  const entry = page.getByRole("button", { name: "대화 목록 열기" });
  await entry.click(); await expect(page.getByRole("dialog", { name: "대화 목록", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(entry).toBeFocused();
  for (const paper of papers) await addMaterial(page, paper.title);
  await page.getByRole("button", { name: "자료 추가", exact: true }).click();
  await page.getByRole("textbox", { name: "연구 질문" }).fill("@토요일");
  await expect(page.getByRole("listbox")).toBeVisible();
  const box = await page.getByRole("listbox").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("free-chat-mobile-mention.png") });
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "연구 질문" }).fill("자료를 함께 읽어보자.");
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "AI 연결", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "모델" })).toBeInViewport();
  await page.keyboard.press("Escape");
});

test("웹 세션이 끝나면 대화 응답을 지우고 재로그인한다", async ({ page }) => {
  const fixture = await setup(page); await page.goto("/ai-chat");
  await page.getByRole("textbox", { name: "연구 질문" }).fill("자유로운 질문을 이어가자.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("함께 생각한 부분 답변", { exact: true })).toBeVisible(); fixture.expire();
  await expect(page.getByRole("link", { name: "다시 로그인", exact: true })).toBeVisible();
  await expect(page.getByText("함께 생각한 부분 답변", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  expect(fixture.sends()).toBe(1);
});
