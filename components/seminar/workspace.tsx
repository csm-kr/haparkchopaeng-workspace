"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, BookOpen, Check, ChevronRight, MessageSquare, RotateCcw, Sparkles } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useLocalAgent } from "@/components/local-agent/provider";
import { chatSelection } from "@/components/local-agent/chat-selection";
import { BridgeUpdateInfo } from "@/components/local-agent/bridge-update";
import { AgentApiError } from "@/components/agent/client";
import { SeminarReview } from "@/components/agent/seminar-review";
import type { AgentSeminarDraft, AgentTaskView } from "@/types/agent-task";
import type { ResearchPaperOption } from "@/types/research-chat";
import type { SeminarInput } from "@/lib/seminar/contract";
import { seminarApi } from "./client";

interface Props { teamId: string; papers: ResearchPaperOption[]; initialTask?: AgentTaskView | null; initialPaperId?: string; initialError?: string | null; enabled?: boolean }
const stageNames = { directions: "발표 방향", interview: "기획 대화", outline: "목차", deck: "슬라이드" };
export function SeminarWorkspace(props: Props) { return <Workspace key={`${props.teamId}:${props.initialTask?.id ?? "new"}`} {...props} />; }
function Workspace({ papers, initialTask = null, initialPaperId, initialError, enabled = true }: Props) {
  const router = useRouter(), agent = useLocalAgent();
  const [task, setTask] = React.useState(initialTask);
  const [paperId, setPaperId] = React.useState(initialPaperId ?? "");
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(initialError ?? null);
  const [busy, setBusy] = React.useState(false), [blocked, setBlocked] = React.useState(false);
  const [edited, setEdited] = React.useState<AgentSeminarDraft | null>(initialTask?.seminarDraft ?? null);
  const alive = React.useRef(true), lock = React.useRef(false);
  const pending = React.useRef<{ fingerprint: string; requestId: string } | null>(null);
  const end = React.useRef<HTMLDivElement>(null);
  const target = chatSelection(agent?.device, agent?.chatTarget ?? agent?.selectedModel, agent?.effort);
  const connection = agent?.phase === "connected" && target && agent.device ? { deviceId: agent.device.id, ...target } : null;
  const needsUpdate = Boolean(connection && !agent?.device?.providers.find(provider => provider.provider === connection.provider)?.capabilities?.includes("agent_step_v1"));
  const execution = needsUpdate ? null : connection;
  const startHelpId = React.useId();
  const startHelp = !paperId ? "발표할 논문을 선택하면 시작할 수 있어요."
    : needsUpdate ? "논문 읽기를 시작하려면 AI 브릿지를 먼저 업데이트해주세요."
    : !execution ? "AI 브릿지를 연결하면 논문 읽기를 시작할 수 있어요."
    : "선택한 논문을 읽고 발표 방향 2~3개를 제안해요.";
  const workspace = task?.workspace;
  const working = task?.status === "queued" || task?.status === "running";
  const exporting = task?.export?.status === "queued" || task?.export?.status === "running";
  const refreshing = working || exporting;
  const artifactMatches = Boolean(task?.export?.current && JSON.stringify(edited ?? task?.seminarDraft) === JSON.stringify(task?.seminarDraft));
  const published = Boolean(task?.savedPresentation);
  const editable = enabled && !blocked && !published && Boolean(execution) && !busy && !working && !task?.requiresReconnect && !task?.sourceChanged && (!task || ["waiting_input", "waiting_review", "completed"].includes(task.status));
  const stage = workspace?.stage ?? "directions";
  const requestId = (fingerprint: string) => {
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    return pending.current.requestId;
  };
  function fail(cause: unknown) {
    if (!alive.current) return;
    setError(cause instanceof AgentApiError ? cause.message : "PT 작업을 이어가지 못했어요. 같은 내용으로 다시 시도해주세요.");
    if (cause instanceof AgentApiError && (cause.status === 401 || cause.code === "FORBIDDEN" || cause.status === 404)) { setBlocked(true); setTask(null); setEdited(null); }
  }
  async function perform(action: () => Promise<AgentTaskView>) {
    if (lock.current || blocked) return null;
    lock.current = true; setBusy(true); setError(null);
    try { const value = await action(); if (!alive.current) return null; setTask(previous => previous && previous.version > value.version ? previous : value); setEdited(value.seminarDraft ?? null); pending.current = null; return value; }
    catch (cause) { fail(cause); return null; }
    finally { if (alive.current) { lock.current = false; setBusy(false); } }
  }
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const taskId = task?.id;
  React.useEffect(() => {
    if (!taskId || blocked) return;
    let stopped = false, fetching = false;
    const refresh = async () => {
      if (fetching || stopped) return;
      fetching = true;
      try { const value = await seminarApi.get(taskId); if (!stopped && alive.current) setTask(previous => {
        if (!previous || previous.version < value.version) return value;
        if (previous.version > value.version || JSON.stringify(previous) === JSON.stringify(value)) return previous;
        return { ...value, draft: previous.draft, seminarDraft: previous.seminarDraft, workspace: previous.workspace };
      }); }
      catch (cause) { if (!stopped) fail(cause); }
      finally { fetching = false; }
    };
    const interval = refreshing ? setInterval(() => void refresh(), 1500) : null;
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { stopped = true; if (interval) clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [taskId, refreshing, blocked]);
  React.useEffect(() => { setEdited(task?.seminarDraft ?? null); }, [task?.seminarDraft]);
  React.useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [workspace?.messages.length, workspace?.question?.id, working]);
  async function start() {
    if (!execution || !paperId || busy || !enabled) return;
    const input = { ...execution, paperId, kind: "seminar" as const, workflow: "guided" as const, completion: "saved_presentation" as const, goal: "선택한 논문을 먼저 읽고 근거가 있는 발표 방향을 2~3개 제안해줘. 내가 고른 방향에서 한 번에 질문 하나씩 대화하며 기획을 좁히고, 실제 논문 Figure·표·설명 도식 중심의 30분 연구 세미나 PT를 함께 만들자." };
    const result = await perform(() => seminarApi.create({ ...input, requestId: requestId(JSON.stringify(input)) }));
    if (result) router.replace(`/presentations/create/${result.id}`);
  }
  async function turn(input: SeminarInput) {
    if (!task || !execution || !editable) return;
    const body = { ...input, ...execution, expectedVersion: task.version, ...(input.action === "revise" && edited ? { reviewedDraft: edited } : {}) };
    if (await perform(() => seminarApi.turn(task.id, { ...body, requestId: requestId(JSON.stringify(body)) }))) setText("");
  }
  function send() {
    if (!text.trim()) return;
    void turn({ action: stage === "interview" ? "answer" : "revise", text: text.trim() });
  }
  async function control(action: "cancel" | "resume" | "steer") {
    if (!task) return;
    await perform(() => seminarApi.control(task.id, { action, expectedVersion: task.version, ...(action === "steer" ? { goal: task.goal } : {}), ...(action === "cancel" ? {} : execution ?? {}) }));
  }
  async function prepareExport() {
    if (!task || !edited || !execution || exporting || working || busy || !enabled) return;
    const input = { expectedVersion: task.version, seminar: edited };
    await perform(async () => (await seminarApi.export(task.id,{ ...input, requestId: requestId(JSON.stringify(input)) })).task);
  }
  return <section aria-label="논문 PT 제작" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
    <header className="border-b border-border-token px-4 py-5 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[11px] font-medium text-accent">논문에서 발표로</p><h1 className="mt-1 text-[23px] font-semibold tracking-tight text-fg">{task?.seminarDraft?.title ?? "세미나 자료 만들기"}</h1><p className="mt-1 text-[13px] text-fg-muted">논문을 읽고, 대화로 방향을 잡고, 그림과 도식으로 설명해요.</p></div><Button variant="secondary" size="sm" onClick={() => agent?.open()}>{connection ? "AI 연결됨" : "AI 연결하기"}</Button></div>
      {task && <nav aria-label="PT 제작 단계" className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-subtle">{Object.entries(stageNames).map(([key, label], index) => <React.Fragment key={key}>{index > 0 && <ChevronRight size={12} aria-hidden="true" />}<span aria-current={key === stage ? "step" : undefined} className={key === stage ? "font-semibold text-accent" : ""}>{label}</span></React.Fragment>)}</nav>}
    </header>
    {error && <div role="alert" className="mx-4 mt-4 rounded-md border border-border-strong bg-bg-subtle p-3 text-[13px] text-busy">{error}<Button variant="ghost" size="sm" onClick={() => router.refresh()}>상태 다시 확인</Button></div>}
    {!enabled && <p role="status" className="px-6 py-4 text-[13px] text-fg-muted">PT 제작 기능을 준비하고 있어요. 이전 작업은 보관돼요.</p>}
    {enabled && !blocked && needsUpdate && <div className="mx-4 mt-4 flex flex-col gap-3 rounded-md border border-border-strong bg-bg-subtle p-4 sm:mx-6"><p role="status" className="text-[13px] font-medium text-fg">연결된 AI 브릿지에 업데이트가 필요해요.</p><p className="text-[12px] leading-relaxed text-fg-muted">업데이트한 뒤 다시 연결하면, 선택한 논문과 작성 중인 대화를 그대로 이어갈 수 있어요.</p><BridgeUpdateInfo onReconnect={() => agent?.start()} /></div>}
    {!task && (initialError || blocked) ? <div className="p-6"><Link href="/presentations" className="text-accent">발표 자료로 돌아가기</Link></div> : !task ? <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-14"><Card className="flex flex-col gap-4 p-5 sm:p-7"><BookOpen size={24} className="text-accent" aria-hidden="true" /><h2 className="text-[18px] font-semibold text-fg">먼저, 발표할 논문을 골라주세요.</h2><p className="text-[13px] leading-relaxed text-fg-muted">에이전트가 원문에서 주장과 근거를 읽고 발표 방향을 제안해요. 한 질문씩 이야기한 내용을 목차와 슬라이드에 이어갑니다.</p>{papers.length ? <><label htmlFor="seminar-paper" className="text-[12px] font-medium text-fg-muted">발표할 논문</label><select id="seminar-paper" value={paperId} disabled={busy || blocked} onChange={event => setPaperId(event.target.value)} className="min-h-11 w-full rounded-md border border-border-strong bg-bg-elevated px-3 text-[13px] text-fg"><option value="">논문 선택</option>{papers.map(paper => <option key={paper.id} value={paper.id}>{paper.title}</option>)}</select><p className="text-[11px] text-fg-subtle">Figure·표·설명 도식 중심 · 기본 30분 · 대화 중 변경 가능</p><p id={startHelpId} role="status" className="text-[12px] text-fg-muted">{startHelp}</p><Button aria-describedby={startHelpId} disabled={!paperId || !execution || busy || blocked || !enabled} onClick={() => void start()}>{busy ? "논문 작업을 준비하고 있어요…" : "논문 읽고 시작하기"}</Button></> : <><p className="text-[13px] text-fg-muted">팀에 등록한 논문이 없어요.</p><Link href="/library" className="text-[13px] font-medium text-accent">논문 등록하러 가기</Link></>}{!connection && <p className="text-[12px] text-fg-muted">왼쪽 연결 설정에서 이 PC의 AI 브릿지를 연결하면 시작할 수 있어요.</p>}</Card></div> : <div className="grid min-w-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="order-2 min-w-0 p-4 sm:p-6 xl:order-1"><div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[12px]"><Link href={`/papers/${task.paper.id}`} className="flex min-w-0 items-center gap-1.5 text-fg-muted hover:text-accent"><BookOpen size={14} className="shrink-0" /><span className="truncate">{task.paper.title}</span></Link><a href={`/api/papers/${task.paper.id}/pdf`} target="_blank" rel="noreferrer" className="text-accent">원문 PDF 보기</a></div>
        {workspace?.directions.length ? <div className="mb-6"><h2 className="mb-3 text-[16px] font-semibold text-fg">논문에서 찾은 발표 방향</h2><div className="grid gap-3 lg:grid-cols-2">{workspace.directions.map(direction => <Card key={direction.id} className={`flex flex-col gap-2 p-4 ${workspace.selectedDirectionId === direction.id ? "border-accent" : ""}`}><div className="flex items-center justify-between gap-2"><h3 className="text-[14px] font-semibold text-fg">{direction.title}</h3>{workspace.selectedDirectionId === direction.id && <Check size={16} className="shrink-0 text-accent" />}</div><p className="text-[13px] leading-relaxed text-fg">{direction.message}</p><p className="text-[12px] leading-relaxed text-fg-muted">{direction.focus}</p><p className="text-[11px] leading-relaxed text-fg-subtle">범위 · {direction.tradeoff}</p><div className="mt-auto pt-2"><Button variant={workspace.selectedDirectionId === direction.id ? "ghost" : "secondary"} size="sm" disabled={!editable} onClick={() => void turn({ action: "choose", directionId: direction.id })}>{workspace.selectedDirectionId === direction.id ? "선택한 방향" : "이 방향으로 준비"}</Button><span className="ml-2 font-mono text-[10px] text-fg-subtle">p.{[...new Set(direction.citations.map(citation => citation.page))].join(", ")}</span></div></Card>)}</div></div> : <Card className="mb-5 flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center"><Sparkles size={26} className="text-accent" /><h2 className="text-[16px] font-semibold text-fg">{working ? "논문에서 발표의 실마리를 찾고 있어요." : task.status === "cancelled" ? "발표 준비를 멈췄어요." : task.error ? "발표 방향을 준비하지 못했어요." : "논문에서 발표 방향을 함께 찾아요."}</h2><p className="max-w-md text-[13px] leading-relaxed text-fg-muted">{working ? "원문을 읽은 뒤 서로 다른 발표 방향과 그 근거가 여기에 나타나요." : task.error ?? "연결을 확인하고 준비를 이어가주세요."}</p></Card>}
        {workspace?.selectedDirectionId && <Card className="mb-6 p-4"><h2 className="text-[14px] font-semibold text-fg">함께 정한 발표 기획</h2><dl className="mt-3 grid gap-3 text-[12px] sm:grid-cols-2">{[["한 줄 메시지", workspace.brief.message], ["청중", workspace.brief.audience], ["발표 시간", `${workspace.brief.durationMinutes}분`], ["설명 깊이", workspace.brief.depth], ["발표 후 토론", workspace.brief.discussionGoal]].map(([label, value]) => <div key={label}><dt className="text-fg-subtle">{label}</dt><dd className="mt-1 leading-relaxed text-fg">{value || "대화로 정해요"}</dd></div>)}</dl>{!!workspace.brief.assumptions.length && <details className="mt-3 text-[11px] text-fg-subtle"><summary className="cursor-pointer">우선 가정한 내용</summary><ul className="mt-2 space-y-1">{workspace.brief.assumptions.map((value, index) => <li key={index}>{value}</li>)}</ul></details>}</Card>}
        {!!workspace?.outline.length && !task.seminarDraft && <div className="mb-6"><h2 className="mb-3 text-[16px] font-semibold text-fg">발표 목차와 시각자료 계획</h2><ol className="space-y-3">{workspace.outline.map((slide, index) => <li key={slide.id} className="flex gap-3 rounded-md border border-border-token bg-bg-elevated p-4"><span className="font-mono text-[12px] text-accent">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><h3 className="text-[14px] font-semibold text-fg">{slide.title}</h3><p className="mt-1 text-[13px] text-fg-muted">{slide.claim}</p><p className="mt-2 text-[12px] text-fg-subtle">{slide.visualPlan} · 원문 p.{slide.sourcePages.join(", ")}</p></div></li>)}</ol></div>}
        {task.seminarDraft && <><Card className="p-4 sm:p-5"><SeminarReview key={`${task.revision}:${task.phase}`} draft={task.seminarDraft} sourcePaperId={task.paper.id} published={published} disabled={busy || working} canSave={editable && task.canSave && artifactMatches && task.export?.status === "done"} onEdit={setEdited} onSave={value => void perform(() => seminarApi.save(task.id, { expectedVersion: task.version, seminar: value, ...(artifactMatches && task.export?.status === "done" ? { artifactJobId: task.export.id } : {}) }))} /></Card>{!published && (!artifactMatches || task.export?.status !== "done") && <p role="status" className="mt-2 text-[12px] leading-relaxed text-fg-muted">HTML/PDF를 먼저 준비해 출력 내용을 확인한 뒤 세미나를 등록해주세요.</p>}</>}
        {task.seminarDraft && <Card className="mt-4 flex flex-col gap-3 p-4"><h2 className="text-[14px] font-semibold text-fg">발표 파일</h2><p className="text-[12px] leading-relaxed text-fg-muted">그림과 도식이 포함된 16:9 HTML·PDF를 준비해요. HTML은 인터넷 연결 없이 발표할 수 있어요.</p><div className="flex flex-wrap items-center gap-3"><Button variant="secondary" size="sm" disabled={!enabled || !execution || busy || working || exporting || blocked} onClick={() => void prepareExport()}>{exporting ? "HTML/PDF를 준비하고 있어요…" : task.export ? "현재 내용으로 HTML/PDF 다시 준비" : "HTML/PDF 준비"}</Button>{artifactMatches && task.export?.files.map(file => <a key={file.format} href={file.href} download className="text-[13px] font-medium text-accent hover:underline">{file.format.toUpperCase()} 다운로드</a>)}</div>{task.export?.error && <p role="status" className="text-[12px] leading-relaxed text-busy">{task.export.error}</p>}{task.export?.status === "failed" && editable && <Button variant="ghost" size="sm" className="self-start" onClick={() => void turn({ action: "revise", text: `출력 검수 오류를 고쳐줘: ${task.export?.error}. 원문 근거와 합의한 발표 방향을 유지하면서 읽기 좋게 다듬자.` })}>출력 오류 수정 요청</Button>}{task.export && !artifactMatches && !exporting && <p className="text-[12px] text-fg-subtle">수정한 슬라이드에 맞춰 파일을 다시 준비해주세요.</p>}{artifactMatches && task.export?.status === "done" && <p className="text-[11px] text-fg-subtle">{task.export.qa?.slideCount}장 · 16:9 · 한글 폰트 포함 · 화면 넘침 검사 완료</p>}</Card>}
        {task.savedPresentation && <p role="status" className="mt-4 text-[13px] text-fg-muted">{task.savedPresentation.verified ? <Link href={task.savedPresentation.href} className="font-medium text-accent">등록한 발표 자료 보기 →</Link> : "등록된 발표 자료의 현재 내용을 확인해주세요."}</p>}
      </div>
      <aside aria-label="PT 에이전트 대화" className="order-1 flex min-w-0 flex-col border-b border-border-token bg-bg-elevated xl:order-2 xl:border-b-0 xl:border-l"><div className="flex items-center gap-2 border-b border-border-token px-4 py-3 text-[13px] font-semibold text-fg"><MessageSquare size={16} className="text-accent" />함께 기획하기</div><div className="flex flex-col gap-4 p-4">{workspace?.messages.map(message => <div key={message.id} className={message.role === "user" ? "ml-5 whitespace-pre-wrap break-words rounded-md bg-bg-subtle p-3 text-[13px] leading-relaxed text-fg" : "whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg-muted"}>{message.role === "assistant" && <p className="mb-1 text-[10px] font-semibold text-accent">PT 파트너</p>}<p>{message.text}</p></div>)}
        {workspace?.question && !working && <Card className="flex flex-col gap-3 p-4"><p className="text-[14px] font-semibold leading-relaxed text-fg">{workspace.question.text}</p><div className="flex flex-col gap-2">{workspace.question.options.map(option => <button type="button" key={option.id} disabled={!editable} onClick={() => void turn({ action: "answer", text: option.label })} className="rounded-md border border-border-strong px-3 py-2.5 text-left text-[13px] leading-relaxed text-fg hover:border-accent disabled:opacity-50">{option.label}{option.id === workspace.question!.recommendedId && <span className="ml-2 rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">추천</span>}</button>)}</div><p className="text-[11px] leading-relaxed text-fg-subtle">{workspace.question.reason}</p></Card>}
        {working && <p role="status" className="flex items-center gap-2 text-[12px] text-fg-muted"><Sparkles size={14} className="text-accent" />{stage === "directions" ? "원문 근거로 발표 방향을 정리하고 있어요…" : stage === "deck" ? "논문과 기획에 맞춰 슬라이드를 다듬고 있어요…" : "답변과 원문을 함께 검토하고 있어요…"}</p>}{task.error && <p role="status" className="text-[12px] leading-relaxed text-busy">{task.error}</p>}<div ref={end} />
        {!published && <><label htmlFor="seminar-reply" className="sr-only">PT 에이전트에게 말하기</label><textarea id="seminar-reply" value={text} maxLength={4000} disabled={!editable} rows={4} placeholder={workspace?.question ? "다른 생각이나 구체적인 조건을 자유롭게 말해주세요." : "방법 설명은 줄이고 실험 조건을 더 깊게 다루자…"} onChange={event => setText(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); send(); } }} className="w-full resize-y rounded-md border border-border-strong bg-bg px-3 py-2 text-[13px] leading-relaxed text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-60" /><Button className="self-end" size="sm" disabled={!editable || !text.trim()} onClick={send}><ArrowUp size={14} />답변 보내기</Button>
        {workspace?.selectedDirectionId && !workspace.outline.length && <Button variant="secondary" disabled={!editable} onClick={() => void turn({ action: "outline" })}>지금 기획으로 목차 만들기</Button>}{!!workspace?.outline.length && !task.seminarDraft && <Button disabled={!editable} onClick={() => void turn({ action: "build" })}>이 목차로 PT 만들기</Button>}
        <div className="flex flex-wrap gap-2">{working && task.canCancel && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void control("cancel")}>작업 중지</Button>}{task.canResume && (task.requiresReconnect || ["failed", "waiting_connection", "cancelled"].includes(task.status)) && <Button variant="secondary" size="sm" disabled={!execution || busy} onClick={() => void control("resume")}>연결 후 이어가기</Button>}{(task.sourceChanged || task.phase === "source_changed") && <Button variant="secondary" size="sm" disabled={!execution || busy} onClick={() => void control("steer")}><RotateCcw size={13} />최신 원문으로 다시 시작</Button>}</div></>}
      </div></aside>
    </div>}
  </section>;
}
