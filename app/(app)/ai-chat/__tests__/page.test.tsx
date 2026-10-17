import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ChatPage from "../page";
import ConversationPage from "../[id]/page";

const mock = vi.hoisted(() => ({ session: vi.fn(), team: vi.fn(), papers: vi.fn(), list: vi.fn(), get: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getConnectionSession: mock.session }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: mock.team }));
vi.mock("@/lib/research-chat/service", () => ({ listResearchPapers: mock.papers, listConversations: mock.list, getConversation: mock.get }));
vi.mock("next/navigation", () => ({ redirect: mock.redirect }));
vi.mock("@/components/shell", () => ({ Topbar: () => <div>상단바</div> }));
beforeEach(() => {
  vi.resetAllMocks();
  mock.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  mock.session.mockResolvedValue({ memberId: "me", sessionKey: "private-session", expiresAt: new Date("2026-12-01") });
  mock.team.mockResolvedValue({ id: "active-team" });
  mock.papers.mockResolvedValue([]); mock.list.mockResolvedValue([]);
});
afterEach(cleanup);

it("채팅 화면은 인증 전에 개인 이력을 조회하지 않는다", async () => {
  mock.session.mockResolvedValue(null);
  await expect(ChatPage({})).rejects.toThrow("redirect:/");
  expect(mock.list).not.toHaveBeenCalled(); expect(mock.papers).not.toHaveBeenCalled();
});

it("저장한 대화는 서버가 확인한 활성 팀과 작성자로 읽고 공개 props에 세션을 넣지 않는다", async () => {
  mock.get.mockResolvedValue({ conversation: { id: "chat-a", title: "내 저장 대화", paperIds: ["p1"], createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" }, papers: [{ id: "p1", title: "팀 논문", sourceReady: true }], turns: [], hasEarlierTurns: false });
  const view = await ConversationPage({ params: Promise.resolve({ id: "chat-a" }) });
  expect(mock.get).toHaveBeenCalledWith(expect.objectContaining({ memberId: "me", teamId: "active-team" }), "chat-a");
  render(view);
  expect(screen.getByRole("heading", { name: "내 저장 대화" })).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("private-session");
  expect(JSON.stringify(view)).not.toContain("private-session");
});

it.each([{ input: "p1", count: 1 }, { input: "other-team-paper", count: 0 }])("논문 상세 진입의 $input은 검증된 팀 논문일 때만 선택한다", async ({ input, count }) => {
  mock.papers.mockResolvedValue([{ id: "p1", title: "검증한 팀 논문", sourceReady: true }]);
  render(await ChatPage({ searchParams: Promise.resolve({ paperId: input }) }));
  expect(screen.getByRole("button", { name: `팀 논문 선택 (${count}/3)` })).toBeInTheDocument();
});
