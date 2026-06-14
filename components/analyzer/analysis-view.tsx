"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ImageOff, Plus, X } from "lucide-react";
import { Avatar, Badge, Button, Card, Input, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AnalysisStatus, Lens, NoteLens, ReproPayload, ResearchPayload } from "@/types";
import { researchSections, reproSections, type SectionDef } from "./sections";

// 논문 분석 — 두 관점 토글 + 섹션 카드 + 두 관점 공통 Figure + 섹션별 작성자 노트.
// CRITICAL: 탭/사이드패널 없음 — 두 관점 토글 자체가 페이지다(ADR-004/R9).
// 읽기 데이터는 RSC(page)에서 props로 내려오고, 노트 쓰기는 Server Action(props)으로 위임한다(ADR-015/R32).

const FIGURES_SECTION_ID = "figures";

export interface NoteAuthor {
  id: string;
  name: string;
  initial: string;
  /** 멤버 색 토큰값 (예: "var(--m-ha)") */
  color: string;
}

export interface NoteView {
  id: string;
  sectionId: string;
  lens: NoteLens;
  title: string;
  body: string;
  createdAt: string;
  author: NoteAuthor | null;
}

export interface FigureView {
  id: string;
  title: string;
  caption: string;
  /** 평이한 언어 설명(해석) */
  interpretation: string;
  sourcePage: number;
  imageUrl?: string | null;
}

/** 노트 추가 입력 — authorId는 보내지 않는다(서버가 세션에서 주입, R3). */
export interface AddNoteInput {
  paperId: string;
  sectionId: string;
  lens: NoteLens;
  title: string;
  body: string;
}

export interface AnalysisViewProps {
  paperId: string;
  analysisStatus: AnalysisStatus;
  research: ResearchPayload | null;
  repro: ReproPayload | null;
  figures: FigureView[];
  notes: NoteView[];
  currentUser: NoteAuthor;
  addNote: (input: AddNoteInput) => Promise<NoteView>;
  deleteNote: (input: { noteId: string; paperId: string }) => Promise<void>;
}

const LENS_HINT: Record<Lens, string> = {
  research: "이 논문이 무엇을·왜 — 문제·기여·비교를 읽어요.",
  repro: "어떻게 다시 만드나 — 데이터·모델·학습·리소스를 봐요.",
};

export function AnalysisView({
  paperId,
  analysisStatus,
  research,
  repro,
  figures,
  notes: initialNotes,
  currentUser,
  addNote,
  deleteNote,
}: AnalysisViewProps) {
  const [lens, setLens] = React.useState<Lens>("research");
  // 마운트 후에는 로컬 상태가 노트의 진실 — 낙관적 추가/삭제를 여기서 관리한다.
  const [notes, setNotes] = React.useState<NoteView[]>(initialNotes);
  const [addingSec, setAddingSec] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [confirmDel, setConfirmDel] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // 분석이 아직 준비되지 않았으면 섹션 대신 상태 블록을 보인다(SCREENS §화면별 상태).
  // 원문 PDF 다운로드는 분석 상태와 무관하게 헤더(page)에서 동작한다(R28).
  if (analysisStatus !== "ready") {
    return <AnalysisStatusBlock status={analysisStatus} paperId={paperId} />;
  }

  function startAdd(sectionId: string) {
    setAddingSec(sectionId);
    setFormError(null);
    setTitle("");
    setBody("");
  }

  function cancelAdd() {
    setAddingSec(null);
    setFormError(null);
  }

  function lensForSection(sectionId: string): NoteLens {
    // figures 노트는 항상 any — 어느 관점에서도 figure 아래 표시(ADR-005/R11).
    return sectionId === FIGURES_SECTION_ID ? "any" : lens;
  }

  async function submitAdd(sectionId: string) {
    const t = title.trim();
    const b = body.trim();
    // 검증은 인라인 — 토스트가 아니라 입력 옆 안내(R30/DESIGN_GUIDE §UX 패턴).
    if (!t || !b) {
      setFormError("내용을 입력해주세요.");
      return;
    }

    const noteLens = lensForSection(sectionId);
    const tempId = `temp-${Date.now()}`;
    const optimistic: NoteView = {
      id: tempId,
      sectionId,
      lens: noteLens,
      title: t,
      body: b,
      createdAt: new Date().toISOString(),
      author: currentUser,
    };
    // 낙관적 반영(작성자 = 세션 사용자) 후 폼 닫기.
    setNotes((prev) => [...prev, optimistic]);
    setAddingSec(null);
    setTitle("");
    setBody("");
    setActionError(null);

    try {
      const saved = await addNote({
        paperId,
        sectionId,
        lens: noteLens,
        title: t,
        body: b,
      });
      setNotes((prev) => prev.map((n) => (n.id === tempId ? saved : n)));
    } catch {
      // 실패 시 롤백 + 인라인 안내(낙관적 UI 규약).
      setNotes((prev) => prev.filter((n) => n.id !== tempId));
      setActionError("추가하지 못했어요. 잠깐 후 다시 시도해주세요.");
    }
  }

  async function doDelete(noteId: string) {
    const prev = notes;
    setNotes((curr) => curr.filter((n) => n.id !== noteId));
    setConfirmDel(null);
    setActionError(null);
    try {
      await deleteNote({ noteId, paperId });
    } catch {
      setNotes(prev);
      setActionError("삭제하지 못했어요. 잠깐 후 다시 시도해주세요.");
    }
  }

  const currentPayload = lens === "research" ? research : repro;
  const sections: SectionDef[] =
    lens === "research"
      ? research
        ? researchSections(research)
        : []
      : repro
        ? reproSections(repro)
        : [];

  function notesFor(sectionId: string): NoteView[] {
    const want = lensForSection(sectionId);
    return notes.filter((n) => n.sectionId === sectionId && n.lens === want);
  }

  function renderNotes(sectionId: string, sectionTitle: string) {
    const list = notesFor(sectionId);
    const isAdding = addingSec === sectionId;
    return (
      <div className="mt-4 flex flex-col gap-2 border-t border-border-token pt-4">
        {list.map((n) => (
          <div
            key={n.id}
            className="flex gap-2.5 rounded-md bg-bg-subtle px-3 py-2.5"
          >
            {n.author && <Avatar user={n.author} size="sm" className="mt-0.5" />}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-baseline gap-2">
                  <span className="text-[12px] font-medium text-fg">
                    {n.title}
                  </span>
                  {n.author && (
                    <span className="text-[11px] text-fg-subtle">
                      {n.author.name}
                    </span>
                  )}
                </span>
                {n.author?.id === currentUser.id &&
                  (confirmDel === n.id ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => doDelete(n.id)}
                      >
                        삭제
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDel(null)}
                      >
                        취소
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label="노트 삭제"
                      onClick={() => setConfirmDel(n.id)}
                      className="shrink-0 rounded-sm p-0.5 text-fg-faint hover:bg-bg-hover hover:text-fg"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  ))}
              </div>
              <p className="text-[13px] whitespace-pre-wrap text-fg-muted">
                {n.body}
              </p>
            </div>
          </div>
        ))}

        {isAdding ? (
          <div className="flex flex-col gap-2 rounded-md border border-border-strong p-3">
            <Input
              placeholder="제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="노트 제목"
            />
            <textarea
              placeholder="분석 내용을 적어주세요"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="노트 내용"
              rows={3}
              className="w-full resize-y rounded-sm border border-border-strong bg-bg-elevated px-3 py-[9px] text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-faint focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
            />
            {formError && (
              <p role="alert" className="text-[12px] text-busy">
                {formError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={cancelAdd}>
                취소
              </Button>
              <Button size="sm" onClick={() => submitAdd(sectionId)}>
                추가
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-fg-subtle"
            aria-label={`${sectionTitle} 섹션에 분석 추가`}
            onClick={() => startAdd(sectionId)}
          >
            <Plus size={14} aria-hidden="true" />이 섹션에 분석 추가
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 관점 토글 — 상단 고정. 두 관점뿐(research/repro), 탭 아님(R9/R10). */}
      <div className="flex flex-col gap-2">
        <div
          role="group"
          aria-label="분석 관점"
          className="inline-flex w-fit gap-1 rounded-md border border-border-token bg-bg-subtle p-1"
        >
          {(["research", "repro"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lens === l}
              onClick={() => setLens(l)}
              className={cn(
                "rounded-sm px-3 py-1.5 text-[13px] font-medium transition-colors",
                lens === l
                  ? "bg-bg-elevated text-fg shadow-[var(--shadow-xs)]"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {l === "research" ? "🔬 연구 분석" : "🛠️ 재구현 분석"}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-fg-subtle">{LENS_HINT[lens]}</p>
      </div>

      {actionError && (
        <p
          role="alert"
          className="rounded-md bg-bg-subtle px-3 py-2 text-[13px] text-busy"
        >
          {actionError}
        </p>
      )}

      {currentPayload === null ? (
        <Card className="px-4 py-8 text-center text-[13px] text-fg-subtle">
          이 관점 분석이 아직 없어요.
        </Card>
      ) : (
        sections.map((s) => {
          const hid = `section-${s.id}`;
          return (
            <Card key={s.id} className="p-4" aria-labelledby={hid}>
              <h3 id={hid} className="text-[16px] font-semibold text-fg">
                {s.title}
              </h3>
              <div className="mt-3">{s.content}</div>
              {renderNotes(s.id, s.title)}
            </Card>
          );
        })
      )}

      {/* Figure 분석 — 연구 관점 전용(재구현 관점엔 숨김). figure 노트(lens:any)도 함께 가려진다(R11). */}
      {lens === "research" && (
      <section aria-labelledby="section-figures" className="flex flex-col gap-3">
        <h3 id="section-figures" className="text-[16px] font-semibold text-fg">
          Figure 분석
        </h3>
        {figures.length === 0 ? (
          <Card className="px-4 py-8 text-center text-[13px] text-fg-subtle">
            추출된 figure가 아직 없어요.
          </Card>
        ) : (
          figures.map((f) => (
            <Card key={f.id} className="flex flex-col gap-3 p-4">
              <Badge className="w-fit bg-bg-subtle text-fg-muted">
                원문 PDF p.{f.sourcePage}에서 추출
              </Badge>
              {f.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.imageUrl}
                  alt={f.title}
                  className="max-h-80 w-full rounded-md border border-border-token object-contain"
                />
              ) : (
                <div className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong text-fg-subtle">
                  <ImageOff size={20} aria-hidden="true" />
                  <span className="text-[12px]">이미지 없음 — 수동 업로드 대기</span>
                </div>
              )}
              <p className="text-[14px] font-medium text-fg">{f.title}</p>
              <p className="text-[13px] text-fg-muted">{f.caption}</p>
              <div className="flex flex-col gap-1">
                <p className="text-[12px] font-medium text-fg-subtle">설명</p>
                <p className="text-[13px] text-fg-muted">{f.interpretation}</p>
              </div>
            </Card>
          ))
        )}
        <Card className="px-4 py-3">
          {renderNotes(FIGURES_SECTION_ID, "Figure 분석")}
        </Card>
      </section>
      )}
    </div>
  );
}

/** 분석 대기/실패 상태 — 섹션 대신 상태 블록(R26/R28). */
function AnalysisStatusBlock({
  status,
  paperId,
}: {
  status: AnalysisStatus;
  paperId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // pending인 동안 주기적으로 새로고침해 잡 완료(ready) 전이를 자동 반영한다(폴링).
  React.useEffect(() => {
    if (status !== "pending") return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [status, router]);

  async function reanalyze() {
    setBusy(true);
    setError(null);
    try {
      // 재분석은 Inngest 잡으로(R31) — 라우트가 상태를 pending으로 되돌리고 이벤트만 보낸다.
      const res = await fetch(`/api/papers/${paperId}/reanalyze`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      // pending 전이를 다시 그린다(잡이 끝나면 ready로).
      router.refresh();
    } catch {
      setError("다시 분석을 시작하지 못했어요. 잠깐 후 다시 시도해주세요.");
      setBusy(false);
    }
  }

  if (status === "pending") {
    return (
      <Card className="flex flex-col gap-3 p-6">
        <p className="text-[14px] font-medium text-fg">논문을 읽고 있어요…</p>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </Card>
    );
  }
  // failed
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full bg-bg-subtle text-busy"
      >
        <AlertTriangle size={20} />
      </div>
      <p className="text-[15px] font-semibold text-fg">분석을 못 끝냈어요</p>
      <p className="max-w-sm text-[13px] text-fg-muted">
        원문 PDF는 위에서 언제든 받을 수 있어요. 분석만 다시 시도하면 돼요.
      </p>
      <Button variant="secondary" size="sm" onClick={reanalyze} disabled={busy}>
        {busy ? "분석 시작 중…" : "다시 분석"}
      </Button>
      {error && (
        <p role="alert" className="text-[12px] text-busy">
          {error}
        </p>
      )}
    </Card>
  );
}
