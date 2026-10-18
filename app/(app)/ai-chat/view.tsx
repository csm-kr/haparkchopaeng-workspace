import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell";
import { ResearchChat } from "@/components/research-chat/research-chat";
import { getConnectionSession } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { HttpError } from "@/lib/http";
import { getConversation, listConversations, listResearchPapers, listResearchPresentations } from "@/lib/research-chat/service";
import type { ResearchConversationDetail, ResearchConversationView, ResearchPaperOption, ResearchPresentationOption } from "@/types/research-chat";

/** Private history is server-scoped; the session credential never becomes a client prop. */
export async function ResearchChatPage({ conversationId, initialPaperId }: { conversationId?: string; initialPaperId?: string } = {}) {
  const session = await getConnectionSession();
  if (!session) redirect("/");
  const team = await getActiveTeam(session.memberId);
  if (!team) redirect("/teams");
  const scope = { memberId: session.memberId, teamId: team.id, sessionKey: session.sessionKey, sessionExpiresAt: session.expiresAt };
  let papers: ResearchPaperOption[] = [], conversations: ResearchConversationView[] = [], detail: ResearchConversationDetail | null = null;
  let presentations: ResearchPresentationOption[] = [];
  let error: string | null = null;
  try {
    [papers, presentations, conversations, detail] = await Promise.all([listResearchPapers(scope), listResearchPresentations(scope), listConversations(scope), conversationId ? getConversation(scope, conversationId) : Promise.resolve(null)]);
  } catch (cause) {
    error = cause instanceof HttpError && cause.status === 404 ? "현재 팀에서 열 수 없는 대화예요." : "대화를 불러오지 못했어요. 잠시 뒤 상태를 다시 확인해 주세요.";
  }
  return <><Topbar crumbs={[{ label: "AI 채팅", ...(conversationId ? { href: "/ai-chat" } : {}) }, ...(detail ? [{ label: detail.conversation.title }] : [])]} />
    <ResearchChat teamId={team.id} initialPapers={papers} initialPresentations={presentations} initialConversations={conversations} initialDetail={detail} initialConversationId={conversationId} initialPaperId={papers.some((paper) => paper.id === initialPaperId) ? initialPaperId : undefined} initialError={error} />
  </>;
}
