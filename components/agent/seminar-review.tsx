"use client";
import * as React from "react";
import { Button, Input } from "@/components/ui";
import { SlideDeck } from "@/components/presentations/slide-deck";
import type { AgentSeminarDraft } from "@/types/agent-task";

export function SeminarReview({ draft, published, disabled, canSave, onSave, onEdit, sourcePaperId }: { draft: AgentSeminarDraft; published: boolean; disabled: boolean; canSave: boolean; onSave: (value: AgentSeminarDraft) => void; onEdit?: (value: AgentSeminarDraft) => void; sourcePaperId?: string }) {
  const [value, setValue] = React.useState(draft);
  const [points, setPoints] = React.useState(draft.keypoints.join("\n"));
  const id = React.useId();
  const keypoints = React.useMemo(() => points.split("\n").map(point => point.trim()).filter(Boolean), [points]);
  const edit = React.useRef(onEdit); edit.current = onEdit;
  React.useEffect(() => { if (!published) edit.current?.({ ...value, keypoints }); }, [value, keypoints, published]);
  const valid = Boolean(value.title.trim() && value.summary.trim() && value.durationMinutes >= 5 && value.durationMinutes <= 120 && keypoints.length && keypoints.length <= 10 && value.slides.every(slide => slide.title.trim() && slide.body.trim()));
  const textClass = "w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-[13px] leading-relaxed text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";
  const shown = published ? draft : value;
  return <div className="flex min-w-0 flex-col gap-3">
    {published ? <><h4 className="text-[15px] font-semibold text-fg">{draft.title}</h4><p className="whitespace-pre-wrap text-[13px] text-fg-muted">{draft.summary}</p></> : <>
      <label htmlFor={`${id}-title`} className="text-[12px] text-fg-muted">세미나 제목</label><Input id={`${id}-title`} maxLength={180} value={value.title} disabled={disabled} onChange={event => setValue(previous => ({ ...previous, title: event.target.value }))} />
      <label htmlFor={`${id}-duration`} className="text-[12px] text-fg-muted">발표 시간(분)</label><Input id={`${id}-duration`} type="number" min={5} max={120} value={value.durationMinutes} disabled={disabled} onChange={event => setValue(previous => ({ ...previous, durationMinutes: Number(event.target.value) }))} />
      <label htmlFor={`${id}-summary`} className="text-[12px] text-fg-muted">세미나 소개</label><textarea id={`${id}-summary`} className={textClass} rows={3} maxLength={6000} value={value.summary} disabled={disabled} onChange={event => setValue(previous => ({ ...previous, summary: event.target.value }))} />
    </>}
    <SlideDeck slides={shown.slides.map(slide => ({ ...slide, subtitle: slide.subtitle ?? null }))} sourcePaperId={sourcePaperId} />
    {!published && <details><summary className="cursor-pointer text-[12px] text-fg-muted">핵심 내용과 슬라이드 수정</summary><div className="mt-3 flex flex-col gap-3">
      <label htmlFor={`${id}-points`} className="text-[12px] text-fg-muted">핵심 내용(한 줄에 하나)</label><textarea id={`${id}-points`} className={textClass} rows={3} value={points} maxLength={5000} disabled={disabled} onChange={event => setPoints(event.target.value)} />
      {value.slides.map((slide, index) => <fieldset key={index} className="flex flex-col gap-2 rounded-md border border-border-token p-3"><legend className="px-1 text-[12px] text-fg-muted">슬라이드 {index + 1}</legend>
        <label htmlFor={`${id}-slide-${index}`} className="text-[12px] text-fg-muted">{index + 1}번 슬라이드 제목</label><Input id={`${id}-slide-${index}`} maxLength={160} value={slide.title} disabled={disabled} onChange={event => setValue(previous => ({ ...previous, slides: previous.slides.map((item, n) => n === index ? { ...item, title: event.target.value } : item) }))} />
        <label htmlFor={`${id}-body-${index}`} className="text-[12px] text-fg-muted">{index + 1}번 슬라이드 내용</label><textarea id={`${id}-body-${index}`} className={textClass} rows={4} maxLength={3000} value={slide.body} disabled={disabled} onChange={event => setValue(previous => ({ ...previous, slides: previous.slides.map((item, n) => n === index ? { ...item, body: event.target.value } : item) }))} />
      </fieldset>)}
    </div></details>}
    <details className="text-[12px] text-fg-muted"><summary className="cursor-pointer">원문 근거 {draft.citations.length}개</summary><div className="mt-2 flex flex-col gap-2">{draft.citations.map((citation, index) => <blockquote key={index} className="break-words border-l-2 border-border-strong pl-3"><span className="mr-2 font-mono">p.{citation.page}</span>{citation.quote}</blockquote>)}</div></details>
    {!published && <><p className="text-[11px] text-fg-subtle">내용을 검토해 등록하면 ‘발표 자료’에 원문과 연결된 세미나가 생겨요. 날짜 편성은 스케줄에서 진행해요.</p><Button type="button" size="sm" className="min-h-10 self-start" disabled={disabled || !canSave || !valid} onClick={() => onSave({ ...value, keypoints })}>검토한 세미나 등록</Button></>}
  </div>;
}
