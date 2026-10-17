"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button, Input } from "@/components/ui";
import type { ResearchConversationView } from "@/types/research-chat";

export function ConversationList({ conversations, selectedId, onSelect, onNew }: { conversations: ResearchConversationView[]; selectedId?: string; onSelect: (id: string) => void; onNew: () => void }) {
  const [search, setSearch] = React.useState("");
  const shown = conversations.filter((conversation) => conversation.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <Button variant="secondary" className="min-h-10" onClick={onNew}><Plus size={14} aria-hidden="true" />새 대화</Button>
    <Input type="search" aria-label="내 대화 검색" placeholder="내 대화 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
    <nav aria-label="내 AI 대화" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      {shown.map((conversation) => <button type="button" key={conversation.id} aria-current={selectedId === conversation.id ? "page" : undefined} onClick={() => onSelect(conversation.id)}
        className={`flex min-h-11 flex-col gap-1 rounded-sm px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ${selectedId === conversation.id ? "bg-accent-soft text-accent" : "text-fg hover:bg-bg-hover"}`}>
        <span className="line-clamp-2 break-words text-[13px] font-medium">{conversation.title}</span>
        <time dateTime={conversation.updatedAt} className="text-[11px] text-fg-muted">{new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(conversation.updatedAt))}</time>
      </button>)}
      {shown.length === 0 && <p className="px-2 py-5 text-[12px] leading-relaxed text-fg-muted">{conversations.length ? "맞는 대화가 없어요." : "아직 대화가 없어요. 논문을 골라 첫 질문을 남겨 보세요."}</p>}
    </nav>
  </div>;
}
