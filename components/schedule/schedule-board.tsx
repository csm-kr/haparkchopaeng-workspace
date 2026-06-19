"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
} from "lucide-react";
import { Avatar, Badge, Button, Card, EmptyState, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { currentWeekIndex, isBreakWeek } from "@/lib/schedule-logic";
import type {
  MemberOption,
  SaveMonthResult,
  ScheduleMonthView,
  ScheduleWeekView,
  WeekInput,
} from "./types";

// 월 보드 — 빈/편집/확정 3상태(SCREEN_FLOW §schedule). 인터랙티브 섬(ADR-015).
// CRITICAL: 빈 달은 비어 있는 그대로 + CTA 하나(R15/R21). 편집/확정 분리(R16).
// CRITICAL: 편집 중 월 이동 잠김. 저장은 낙관적 락(version) — 충돌 시 입력 보존(R35/R27).

const MONTH_NAMES = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
];

export interface ScheduleBoardProps {
  year: number;
  month: number;
  monthData: ScheduleMonthView | null;
  members: MemberOption[];
  onDraft: (year: number, month: number) => Promise<ScheduleWeekView[]>;
  onSave: (input: {
    year: number;
    month: number;
    version: number;
    weeks: WeekInput[];
  }) => Promise<SaveMonthResult>;
}

function toEditable(w: ScheduleWeekView): WeekInput {
  return { ...w, topic: w.topic ?? "" };
}

export function ScheduleBoard({
  year,
  month,
  monthData,
  members,
  onDraft,
  onSave,
}: ScheduleBoardProps) {
  const router = useRouter();
  // 저장된 월은 로컬 상태 — 저장 성공 시 반환값으로 갱신해 즉시 확정 모드로 전환.
  const [saved, setSaved] = React.useState<ScheduleMonthView | null>(monthData);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<WeekInput[] | null>(null);
  const [baseline, setBaseline] = React.useState<string>(""); // 변경분 감지용 스냅샷
  const [drafting, setDrafting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [navMsg, setNavMsg] = React.useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = React.useState(false);

  const memberById = React.useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );

  function go(delta: number) {
    // 편집 중에는 월 이동 잠김 — 인라인 안내(R30, 토스트 시스템 부재로 인라인 alert).
    if (editing) {
      setNavMsg("편집 중에는 달을 옮길 수 없어요. 저장하거나 취소해주세요.");
      return;
    }
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    router.push(`/schedule?y=${y}&m=${m}`);
  }

  async function startPlanning() {
    setDrafting(true);
    setSaveError(null);
    setNavMsg(null);
    try {
      const weeks = (await onDraft(year, month)).map(toEditable);
      setDraft(weeks);
      setBaseline(JSON.stringify(weeks));
      setEditing(true);
    } catch {
      setSaveError("초안을 만들지 못했어요. 잠깐 후 다시 시도해주세요.");
    } finally {
      setDrafting(false);
    }
  }

  function editExisting() {
    if (!saved) return;
    const weeks = saved.weeks.map(toEditable);
    setDraft(weeks);
    setBaseline(JSON.stringify(weeks));
    setEditing(true);
    setSaveError(null);
    setNavMsg(null);
    setCancelConfirm(false);
  }

  function updateWeek(idx: number, patch: Partial<WeekInput>) {
    setDraft((ws) =>
      ws ? ws.map((w, i) => (i === idx ? { ...w, ...patch } : w)) : ws,
    );
  }

  const isDirty = draft != null && JSON.stringify(draft) !== baseline;

  function cancel() {
    // 변경분이 있으면 확인(R27): 초안이 사라진다는 안내 후 한 번 더.
    if (isDirty && !cancelConfirm) {
      setCancelConfirm(true);
      return;
    }
    setEditing(false);
    setDraft(null);
    setCancelConfirm(false);
    setSaveError(null);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onSave({
        year,
        month,
        version: saved?.version ?? 0,
        weeks: draft,
      });
      if (result.ok) {
        setSaved(result.month);
        setEditing(false);
        setDraft(null);
        setCancelConfirm(false);
      } else {
        // 저장 에러 시 편집 상태·입력 유지(R35/SCREENS): 충돌이면 새로고침 유도.
        setSaveError(result.message);
      }
    } catch {
      setSaveError("저장하지 못했어요. 잠깐 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  const heading = `${year}년 ${MONTH_NAMES[month - 1]}`;
  const confirmedCount = draft?.filter((w) => w.confirmed).length ?? 0;

  return (
    <Card className="flex flex-col">
      {/* 보드 헤더 — 월 내비 + 모드 표시/수정 진입 */}
      <div className="flex items-center justify-between gap-3 border-b border-border-token px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="이전 달"
            onClick={() => go(-1)}
            className="rounded-sm p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <h2 className="min-w-[7rem] text-center text-[20px] font-semibold text-fg">
            {heading}
          </h2>
          <button
            type="button"
            aria-label="다음 달"
            onClick={() => go(1)}
            className="rounded-sm p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        {editing ? (
          <Badge className="bg-accent-soft text-accent">편집 모드</Badge>
        ) : saved ? (
          <Button variant="ghost" size="sm" onClick={editExisting}>
            <Pencil size={13} aria-hidden="true" /> 수정
          </Button>
        ) : null}
      </div>

      {navMsg && (
        <p
          role="alert"
          className="border-b border-border-token bg-bg-subtle px-4 py-2 text-[12px] text-busy"
        >
          {navMsg}
        </p>
      )}

      {/* 빈 달 — row 부재. 자동 생성하지 않는다(R15/ADR-006). */}
      {!editing && !saved && (
        <div className="p-4">
          <EmptyState
            icon={<Calendar size={20} />}
            title="이 달은 아직 일정이 없어요"
            description={`${heading}의 토요일 세미나를 편성해볼까요?`}
            action={
              <Button onClick={startPlanning} disabled={drafting}>
                <Plus size={13} aria-hidden="true" />
                {drafting ? "준비 중…" : "일정 짜기"}
              </Button>
            }
          />
          {saveError && (
            <p role="alert" className="mt-3 text-center text-[12px] text-busy">
              {saveError}
            </p>
          )}
        </div>
      )}

      {/* 편집 모드 — 행마다 확정/시간/발표자/주제 */}
      {editing && draft && (
        <div className="flex flex-col">
          <ul className="divide-y divide-border-token">
            {draft.map((w, idx) => {
              const presenter = w.presenterId
                ? memberById.get(w.presenterId)
                : null;
              const brk = isBreakWeek(w.week, draft.length);
              return (
                <li key={w.week} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
                      <input
                        type="checkbox"
                        checked={w.confirmed}
                        onChange={(e) =>
                          updateWeek(idx, { confirmed: e.target.checked })
                        }
                        aria-label={`${w.week}주차 확정`}
                      />
                      확정
                    </label>
                    <span className="flex flex-col">
                      <span className="text-[12px] text-fg-subtle">
                        {w.week}주차
                      </span>
                      <span className="font-mono text-[12px] text-fg">
                        {w.date}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar
                        size={13}
                        className="text-fg-subtle"
                        aria-hidden="true"
                      />
                      <input
                        type="time"
                        value={w.time}
                        onChange={(e) =>
                          updateWeek(idx, { time: e.target.value })
                        }
                        aria-label={`${w.week}주차 시간`}
                        className="rounded-sm border border-border-strong bg-bg-elevated px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
                      />
                    </span>
                    {brk ? (
                      <Badge className="bg-bg-subtle text-away">🌴 방학</Badge>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        {presenter && <Avatar user={presenter} size="sm" />}
                        <select
                          value={w.presenterId ?? ""}
                          onChange={(e) =>
                            updateWeek(idx, {
                              presenterId: e.target.value || null,
                            })
                          }
                          aria-label={`${w.week}주차 발표자`}
                          className="rounded-sm border border-border-strong bg-bg-elevated px-2 py-1 text-[12px] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
                        >
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                              {m.availability === "vacation" ? " (휴가)" : ""}
                            </option>
                          ))}
                        </select>
                        {presenter?.availability === "vacation" && (
                          <Badge className="bg-bg-subtle text-away">휴가</Badge>
                        )}
                      </span>
                    )}
                  </div>
                  {!brk && (
                    <Input
                      value={w.topic}
                      placeholder="발표 주제 입력…"
                      aria-label={`${w.week}주차 주제`}
                      onChange={(e) => updateWeek(idx, { topic: e.target.value })}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {/* 고정 편집 바 — 확정 N/M + 취소/저장 */}
          <div className="flex flex-col gap-2 border-t border-border-token px-4 py-3">
            {saveError && (
              <p role="alert" className="text-[12px] text-busy">
                {saveError}
              </p>
            )}
            {cancelConfirm && (
              <p role="alert" className="text-[12px] text-busy">
                작성 중인 초안이 사라져요. 한 번 더 누르면 취소됩니다.
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-fg-subtle">
                확정 {confirmedCount}/{draft.length} · 발표자·주제를 채우고
                저장하세요
              </span>
              <span className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={cancel}>
                  취소
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? "저장 중…" : "저장"}
                </Button>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 확정(읽기전용) 모드 */}
      {!editing && saved && (
        <ConfirmedWeeks
          year={saved.year}
          month={saved.month}
          weeks={saved.weeks}
          memberById={memberById}
        />
      )}
    </Card>
  );
}

function ConfirmedWeeks({
  year,
  month,
  weeks,
  memberById,
}: {
  year: number;
  month: number;
  weeks: ScheduleMonthView["weeks"];
  memberById: Map<string, MemberOption>;
}) {
  const currentIdx = currentWeekIndex(year, month, weeks);

  return (
    <ul className="divide-y divide-border-token">
      {weeks.map((w, idx) => {
        const presenter = w.presenterId ? memberById.get(w.presenterId) : null;
        const brk = isBreakWeek(w.week, weeks.length);
        const isDone = w.status === "done";
        const isCurrent = !brk && !isDone && idx === currentIdx;
        return (
          <li
            key={w.week}
            className="flex flex-col gap-1.5 px-4 py-3"
            data-current={isCurrent ? "true" : undefined}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex flex-col">
                <span className="text-[12px] text-fg-subtle">{w.week}주차</span>
                <span className="font-mono text-[12px] text-fg">{w.date}</span>
              </span>
              <span className="flex items-center gap-1 font-mono text-[12px] text-fg-muted">
                <Calendar size={12} aria-hidden="true" /> {w.time}
              </span>
              {brk ? (
                <Badge className="bg-bg-subtle text-away">🌴 방학</Badge>
              ) : (
                <span className="flex items-center gap-1.5">
                  {presenter && <Avatar user={presenter} size="sm" />}
                  <span className="text-[13px] font-medium text-fg">
                    {presenter ? presenter.name : "미정"}
                  </span>
                </span>
              )}
              {/* 상태 알약 — 색 + 텍스트 병행(R29). current는 정적 도트(깜빡임 없음). */}
              {!brk && (
              <span className="ml-auto flex items-center gap-2">
                {isDone ? (
                  <Badge className="bg-bg-subtle text-fg-muted">완료</Badge>
                ) : isCurrent ? (
                  <Badge className="bg-accent-soft text-accent">
                    <span
                      aria-hidden="true"
                      className="mr-1 inline-block size-1.5 rounded-full bg-accent align-middle"
                    />
                    이번 주
                  </Badge>
                ) : (
                  <Badge className="bg-bg-subtle text-fg-subtle">발표예정</Badge>
                )}
                {isDone && w.presentationId ? (
                  <Link
                    href={`/presentations/${w.presentationId}`}
                    className="rounded-sm border border-border-strong px-2.5 py-1 text-[12px] font-medium text-fg hover:bg-bg-hover"
                  >
                    자료
                  </Link>
                ) : w.presentationId ? (
                  <Link
                    href={`/presentations/${w.presentationId}`}
                    className="rounded-sm px-2.5 py-1 text-[12px] font-medium text-fg-muted hover:bg-bg-hover hover:text-fg"
                  >
                    미리보기
                  </Link>
                ) : (
                  <span className="text-[12px] text-fg-faint">준비 전</span>
                )}
              </span>
              )}
            </div>
            {!brk && (
              <p
                className={cn(
                  "text-[13px]",
                  w.topic ? "text-fg-muted" : "text-fg-faint",
                )}
              >
                {w.topic || "주제 미정"}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
