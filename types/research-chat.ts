import type { LocalAgentJobView, LocalAgentProvider } from "./local-agent";

/** Sources and history are resolved by the server, never accepted as caller text. */
export interface ResearchPaperOption {
  id: string;
  title: string;
  sourceReady: boolean;
  /** An owned source-preparation message; provider exceptions are never returned. */
  sourceError?: string | null;
}
export interface ResearchConversationView {
  id: string;
  title: string;
  paperIds: string[];
  createdAt: string;
  updatedAt: string;
}
export interface ResearchChatTurn extends LocalAgentJobView {
  conversationId: string;
  conversationTurn: number;
  canCancel: boolean;
  /** Some source text or older conversation was omitted from the model context. */
  contextTruncated: boolean;
}
export interface ResearchConversationDetail {
  conversation: ResearchConversationView;
  papers: ResearchPaperOption[];
  /** Latest 50 turns, in chronological order. */
  turns: ResearchChatTurn[];
  hasEarlierTurns: boolean;
}
export interface ResearchConversationCreateInput {
  requestId: string;
  paperIds: string[];
  title?: string;
}
export interface ResearchChatTurnInput {
  requestId: string;
  deviceId: string;
  provider: LocalAgentProvider;
  model: string;
  prompt: string;
}
