"use client";

import * as React from "react";
import { Button, Input } from "@/components/ui";
import type { ResearchPaperOption } from "@/types/research-chat";
import { ChatDialog } from "./dialog";

export function PaperPicker({ papers, selected, onSelect, onClose }: { papers: ResearchPaperOption[]; selected: string[]; onSelect: (ids: string[]) => void; onClose: () => void }) {
  const [search, setSearch] = React.useState("");
  const shown = papers.filter((paper) => paper.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <ChatDialog title="팀 논문 선택" onClose={onClose}>
    <p className="text-[12px] text-fg-muted">이 대화에서 함께 읽을 논문을 1~3편 골라 주세요. ({selected.length}/3)</p>
    <Input type="search" aria-label="팀 논문 검색" placeholder="논문 제목 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
    <fieldset className="flex max-h-[45dvh] flex-col gap-1 overflow-y-auto">
      <legend className="sr-only">대화에 사용할 팀 논문</legend>
      {shown.map((paper) => <label key={paper.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm p-3 hover:bg-bg-hover">
        <input type="checkbox" className="mt-1 shrink-0 accent-[var(--accent)]" checked={selected.includes(paper.id)} disabled={!selected.includes(paper.id) && selected.length === 3}
          onChange={(event) => onSelect(event.target.checked ? [...selected, paper.id] : selected.filter((id) => id !== paper.id))} />
        <span className="flex min-w-0 flex-col gap-0.5"><span className="break-words text-[13px] text-fg">{paper.title}</span><span className="text-[11px] text-fg-muted">{paper.sourceReady ? "본문 사용 가능" : paper.sourceError ? "본문 준비 실패" : "본문 준비 필요"}</span>
          {!paper.sourceReady && paper.sourceError && <span className="break-words text-[11px] leading-relaxed text-busy">{paper.sourceError}</span>}
        </span>
      </label>)}
      {shown.length === 0 && <p className="p-3 text-[13px] text-fg-muted">맞는 논문이 없어요.</p>}
    </fieldset>
    <Button className="min-h-10" onClick={onClose}>논문 선택 완료</Button>
  </ChatDialog>;
}
