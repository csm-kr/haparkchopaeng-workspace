"use client";
import * as React from "react";
import Link from "next/link";
import { Button, Card, Input } from "@/components/ui";
import type { AgentSeminarDraft, AgentTaskView } from "@/types/agent-task";
import type { TaskControl } from "./client";
import { SeminarReview } from "./seminar-review";

interface Props {
  tasks: AgentTaskView[]; busyId: string | null; connected: boolean;
  onSave: (task: AgentTaskView, input: { title: string; body: string }) => void;
  onControl: (task: AgentTaskView, input: Pick<TaskControl, "action" | "goal">) => void;
  onSeminarSave?: (task: AgentTaskView, seminar: AgentSeminarDraft) => void;
}
const sectionNames: Record<string, string> = { problem: "Problem Setting", contributions: "Contribution", io: "Input / Output", comparison: "Comparison", ablation: "Ablation", data: "데이터", model: "모델", training: "학습", gpu: "리소스", repo: "GitHub 구조", diagram: "구조도", figures: "Figure" };
const statuses: Record<string, string> = { queued: "작업 대기", running: "논문을 읽고 있어요", waiting_input: "입력 확인 필요", waiting_review: "초안 검토 대기", waiting_connection: "연결 확인 필요", completed: "초안 완료", failed: "작업 확인 필요", cancelled: "작업 중지" };
function TaskCard({ task, busyId, connected, onSave, onControl, onSeminarSave }: Omit<Props, "tasks"> & { task: AgentTaskView }) {
  const [title, setTitle] = React.useState(task.draft?.title ?? "");
  const [body, setBody] = React.useState(task.draft?.body ?? "");
  const [editingGoal, setEditingGoal] = React.useState(false);
  const [goal, setGoal] = React.useState(task.goal);
  const titleId = React.useId(), bodyId = React.useId(), goalId = React.useId();
  const busy = busyId !== null;
  const published = Boolean(task.savedNote || task.savedPresentation);
  const status = task.savedNote?.verified ? "저장 확인 완료" : task.savedPresentation?.verified ? "세미나 등록 확인 완료" : statuses[task.status];
  return <Card className="flex min-w-0 flex-col gap-3 p-4 sm:p-5" aria-label="논문 작업">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="text-[11px] font-medium text-accent">{status}</p><h3 className="mt-1 break-words text-[14px] font-semibold text-fg">{task.goal}</h3></div>
      {task.canCancel && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onControl(task, { action: "cancel" })}>작업 중지</Button>}</div>
    <Link href={`/papers/${encodeURIComponent(task.paper.id)}`} className="break-words text-[12px] text-fg-muted hover:text-accent">{task.paper.title}</Link>
    {task.workspace && <Link href={`/presentations/create/${task.id}`} className="text-[12px] font-medium text-accent">PT 제작 대화 이어가기 →</Link>}
    {!!task.activity.length && <p className="text-[11px] text-fg-subtle">{task.activity.slice(-3).map(item => item.label).join(" · ")}</p>}
    {task.error && <p role="status" className="whitespace-pre-wrap break-words text-[12px] text-busy">{task.error}</p>}
    {task.draft && <>
      <p className="text-[12px] text-fg-muted">저장 위치: {task.draft.lens === "research" ? "연구 분석" : task.draft.lens === "repro" ? "재구현 분석" : "공통"} · {sectionNames[task.draft.sectionId] ?? task.draft.sectionId}</p>
      {!task.savedNote ? <div className="flex flex-col gap-2">
        <label htmlFor={titleId} className="text-[12px] text-fg-muted">노트 제목</label><Input id={titleId} value={title} maxLength={180} onChange={event => setTitle(event.target.value)} disabled={busy} />
        <label htmlFor={bodyId} className="text-[12px] text-fg-muted">노트 본문</label><textarea id={bodyId} value={body} maxLength={20_000} onChange={event => setBody(event.target.value)} disabled={busy} rows={7} className="w-full resize-y rounded-md border border-border-strong bg-bg px-3 py-2 text-[13px] leading-relaxed text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft" />
      </div> : <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">{task.draft.body}</p>}
      <details className="text-[12px] text-fg-muted"><summary className="cursor-pointer">원문 근거 {task.draft.citations.length}개</summary><div className="mt-2 flex flex-col gap-2">{task.draft.citations.map((citation, i) => <blockquote key={i} className="break-words border-l-2 border-border-strong pl-3"><span className="mr-2 font-mono text-[11px]">p.{citation.page}</span><span>{citation.quote}</span></blockquote>)}</div></details>
      {!task.savedNote && <><p className="text-[11px] text-fg-subtle">AI가 작성한 초안이에요. 연구 해석을 검토한 뒤 저장하면 팀원이 볼 수 있어요.</p>
        <Button type="button" size="sm" className="min-h-10 self-start" disabled={busy || !connected || !task.canSave || !title.trim() || !body.trim()} onClick={() => onSave(task, { title, body })}>{busyId === task.id ? "저장 확인 중…" : "검토한 내용 저장"}</Button>
        {!task.canSave && <p className="text-[11px] text-fg-muted">AI 연결과 원문 상태를 확인한 뒤 작업을 이어가주세요.</p>}</>}
    </>}
    {task.savedNote && <div className="flex flex-col gap-2">{task.savedNote.verified ? <Link href={task.savedNote.href} className="self-start text-[12px] font-medium text-accent">저장한 노트 보기</Link> : <p role="status" className="text-[12px] text-busy">저장된 노트를 확인하지 못했어요. 논문에서 현재 내용을 확인해주세요.</p>}</div>}
    {task.seminarDraft && !task.workspace && <SeminarReview draft={task.seminarDraft} published={published} disabled={busy || !connected} canSave={task.canSave && Boolean(onSeminarSave)} onSave={seminar => onSeminarSave?.(task, seminar)} />}
    {task.savedPresentation && (task.savedPresentation.verified ? <Link href={task.savedPresentation.href} className="self-start text-[12px] font-medium text-accent">등록한 세미나 보기</Link> : <p role="status" className="text-[12px] text-busy">등록된 발표 자료를 확인하지 못했어요. 목록에서 현재 내용을 확인해주세요.</p>)}
    {!published && <div className="flex flex-wrap items-center gap-2">
      {task.canResume && <Button type="button" size="sm" variant="ghost" disabled={busy || !connected} onClick={() => onControl(task, { action: "resume" })}>연결 후 이어가기</Button>}
      {task.status !== "cancelled" && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditingGoal(value => !value)}>조건 바꾸기</Button>}
    </div>}
    {editingGoal && <div className="flex flex-col gap-2"><label htmlFor={goalId} className="text-[12px] text-fg-muted">작업 조건</label><textarea id={goalId} value={goal} onChange={event => setGoal(event.target.value)} maxLength={12_000} rows={3} className="rounded-md border border-border-strong bg-bg px-3 py-2 text-[13px] text-fg" />
      <Button type="button" size="sm" className="min-h-10 self-start" disabled={busy || !connected || !goal.trim()} onClick={() => { onControl(task, { action: "steer", goal }); setEditingGoal(false); }}>바꾼 조건으로 준비</Button></div>}
  </Card>;
}
export function AgentTaskList({ tasks, ...props }: Props) {
  return <div className="flex min-w-0 flex-col gap-4">{tasks.map(task => <TaskCard key={`${task.id}:${task.revision}:${task.draft || task.seminarDraft ? "draft" : "working"}`} task={task} {...props} />)}</div>;
}
