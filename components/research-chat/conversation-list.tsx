"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button, Input } from "@/components/ui";
import type { ResearchConversationView } from "@/types/research-chat";
import { ConversationMenu } from "./conversation-menu";

export function ConversationList({ conversations, selectedId, onSelect, onNew, onDelete }: { conversations: ResearchConversationView[]; selectedId?: string; onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string) => Promise<boolean> }) {
  const [search, setSearch] = React.useState("");
  const shown = conversations.filter((conversation) => conversation.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <Button variant="secondary" className="min-h-10" onClick={onNew}><Plus size={14} aria-hidden="true" />새 대화</Button>
    <Input type="search" aria-label="내 대화 검색" placeholder="내 대화 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
    <nav aria-label="내 AI 대화" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      {/* Rows keep their content height in this scrolling column; squeezed rows used to hide their titles. */}
      {shown.map((conversation) => <div key={conversation.id} className={`group flex shrink-0 items-start rounded-sm ${selectedId === conversation.id ? "bg-accent-soft text-accent" : "text-fg hover:bg-bg-hover"}`}>
        <button type="button" aria-current={selectedId === conversation.id ? "page" : undefined} onClick={() => onSelect(conversation.id)}
          className="flex min-h-11 min-w-0 flex-1 flex-col gap-1 rounded-sm py-2.5 pl-3 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft">
          <span className="line-clamp-2 text-[13px] font-medium [overflow-wrap:anywhere]">{conversation.title}</span>
          <time dateTime={conversation.updatedAt} className="text-[11px] text-fg-muted">{new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(conversation.updatedAt))}</time>
        </button>
        <ConversationMenu title={conversation.title} triggerLabel={`${conversation.title} 더보기`} onDelete={() => onDelete(conversation.id)}
          className="m-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100" />
      </div>)}
      {shown.length === 0 && <p className="px-2 py-5 text-[12px] leading-relaxed text-fg-muted">{conversations.length ? "맞는 대화가 없어요." : "새로운 이야기를 시작해 보세요."}</p>}
    </nav>
  </div>;
}
