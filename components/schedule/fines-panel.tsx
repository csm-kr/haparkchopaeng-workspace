"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { Avatar, Badge, Button, Card } from "@/components/ui";
import { deriveFineSummary } from "@/lib/schedule-logic";
import type { FinesView, LedgerRowInput } from "./types";

// 벌금 설정 + 로테이션 + 연도별 멤버 현황 표(SCREENS §schedule).
// CRITICAL: 누적 벌금·미납은 저장하지 않고 화면에서 파생(DB.md). 생성·수정은 관리자만(👑, SECURITY/R19).
// 한 섬에 모아 — 벌금 금액/장부를 바꾸면 표가 즉시 재계산되도록(R26/요구사항).
// CRITICAL: 클라는 teamId를 만들지 않는다 — year만 보내고 Server Action이 활성 팀을 주입한다(R3/R37).

const wonFmt = new Intl.NumberFormat("ko-KR");
function won(n: number): string {
  return `${wonFmt.format(n)}원`;
}

// 장부 편집 로컬 상태 — memberId별 원자료 4개. 누적/미납은 들지 않는다(파생).
type LedgerDraftRow = {
  count: number;
  missedPresenter: number;
  missedAbsent: number;
  paid: number;
};

export interface FinesPanelProps {
  fines: FinesView | null;
  isAdmin: boolean;
  /** 설정이 없을(fines === null) 때도 어느 해를 생성할지 알아야 한다 — 서버에 보내는 유일한 키(R3). */
  year: number;
  onUpdate: (input: {
    year: number;
    finePresenter: number;
    fineAbsent: number;
  }) => Promise<FinesView>;
  onCreate: (year: number) => Promise<FinesView>;
  onUpdateLedger: (input: {
    year: number;
    rows: LedgerRowInput[];
  }) => Promise<FinesView>;
}

export function FinesPanel({
  fines: initial,
  isAdmin,
  year,
  onUpdate,
  onCreate,
  onUpdateLedger,
}: FinesPanelProps) {
  const [fines, setFines] = React.useState<FinesView | null>(initial);

  // 벌금 금액 설정 카드 편집
  const [editing, setEditing] = React.useState(false);
  const [presenterAmt, setPresenterAmt] = React.useState(
    initial?.finePresenter ?? 0,
  );
  const [absentAmt, setAbsentAmt] = React.useState(initial?.fineAbsent ?? 0);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 설정 명시 생성(설정 없을 때)
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // 멤버 현황 표 전체 편집
  const [ledgerEditing, setLedgerEditing] = React.useState(false);
  const [ledgerDraft, setLedgerDraft] = React.useState<
    Record<string, LedgerDraftRow>
  >({});
  const [ledgerSaving, setLedgerSaving] = React.useState(false);
  const [ledgerError, setLedgerError] = React.useState<string | null>(null);

  function startEdit() {
    if (!fines) return;
    setPresenterAmt(fines.finePresenter);
    setAbsentAmt(fines.fineAbsent);
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (!fines) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await onUpdate({
        year: fines.year,
        finePresenter: presenterAmt,
        fineAbsent: absentAmt,
      });
      setFines(updated);
      setEditing(false);
    } catch {
      setError("저장하지 못했어요. 잠깐 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function create() {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await onCreate(year); // teamId는 서버가 활성 팀에서 주입(R3)
      setFines(created);
    } catch {
      setCreateError("만들지 못했어요. 잠깐 후 다시 시도해주세요.");
    } finally {
      setCreating(false);
    }
  }

  function startLedgerEdit() {
    if (!fines) return;
    const draft: Record<string, LedgerDraftRow> = {};
    for (const m of fines.members) {
      draft[m.memberId] = {
        count: m.count,
        missedPresenter: m.missedPresenter,
        missedAbsent: m.missedAbsent,
        paid: m.paid,
      };
    }
    setLedgerDraft(draft);
    setLedgerError(null);
    setLedgerEditing(true);
  }

  function setDraftField(
    memberId: string,
    field: keyof LedgerDraftRow,
    value: number,
  ) {
    setLedgerDraft((cur) => ({
      ...cur,
      [memberId]: { ...cur[memberId], [field]: value },
    }));
  }

  async function saveLedger() {
    if (!fines) return;
    setLedgerSaving(true);
    setLedgerError(null);
    try {
      // 원자료 4개만 보낸다 — 누적/미납은 보내지 않는다(파생, DB.md). teamId는 서버가 주입(R3).
      const rows: LedgerRowInput[] = fines.members.map((m) => {
        const d = ledgerDraft[m.memberId];
        return {
          memberId: m.memberId,
          count: d?.count ?? m.count,
          missedPresenter: d?.missedPresenter ?? m.missedPresenter,
          missedAbsent: d?.missedAbsent ?? m.missedAbsent,
          paid: d?.paid ?? m.paid,
        };
      });
      const updated = await onUpdateLedger({ year: fines.year, rows });
      setFines(updated);
      setLedgerEditing(false);
    } catch {
      setLedgerError("저장하지 못했어요. 잠깐 후 다시 시도해주세요.");
    } finally {
      setLedgerSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 벌금 설정 */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-fg">벌금 설정</h2>
          {/* 권한 없는 액션은 숨기지 않고 비활성/부재 — 여기선 관리자에게만 노출(R19/SECURITY). */}
          {isAdmin &&
            fines &&
            (editing ? (
              <span className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(false)}
                >
                  취소
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? "저장 중…" : "저장"}
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={startEdit}>
                <Pencil size={13} aria-hidden="true" /> 수정
              </Button>
            ))}
        </div>

        {!fines ? (
          // 설정 명시 생성(ADR-023) — 자동 생성 아님. 관리자만 "벌금 설정 시작"(SCREENS/R19).
          <div className="flex flex-col items-start gap-3">
            <p className="text-[13px] text-fg-subtle">
              이 해의 벌금 설정이 아직 없어요.
            </p>
            {isAdmin && (
              <Button size="sm" onClick={create} disabled={creating}>
                {creating ? "만드는 중…" : "벌금 설정 시작"}
              </Button>
            )}
            {createError && (
              <p role="alert" className="text-[12px] text-busy">
                {createError}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <FineItem
              label="발표자 불참"
              desc="발표 차례인데 빠질 때"
              amount={fines.finePresenter}
              editing={editing}
              value={presenterAmt}
              onChange={setPresenterAmt}
              ariaLabel="발표자 불참 벌금"
            />
            <FineItem
              label="일반 불참"
              desc="참석만 안 할 때"
              amount={fines.fineAbsent}
              editing={editing}
              value={absentAmt}
              onChange={setAbsentAmt}
              ariaLabel="일반 불참 벌금"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-busy">
            {error}
          </p>
        )}
      </Card>

      {/* 연도별 멤버 현황 — 누적/미납은 현재 벌금값으로 파생 계산(편집 중엔 초안 값으로) */}
      {fines && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[20px] font-semibold text-fg">
              {fines.year} 멤버 현황
            </h2>
            <span className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-fg-subtle">
                발표자 {won(fines.finePresenter)} · 일반 {won(fines.fineAbsent)}
              </span>
              {/* 금액 설정 카드와 동일한 "수정/저장" 토글 — 표 전체 편집 모드(SCREENS).
                  접근성 이름은 금액 토글("수정")과 구분되게 "멤버 현황 수정/저장"으로 둔다. */}
              {isAdmin &&
                (ledgerEditing ? (
                  <span className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLedgerEditing(false)}
                    >
                      취소
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveLedger}
                      disabled={ledgerSaving}
                      aria-label="멤버 현황 저장"
                    >
                      {ledgerSaving ? "저장 중…" : "저장"}
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={startLedgerEdit}
                    aria-label="멤버 현황 수정"
                  >
                    <Pencil size={13} aria-hidden="true" /> 수정
                  </Button>
                ))}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-fg-subtle">
                  <th className="py-2 pr-3 font-medium">멤버</th>
                  <th className="py-2 pr-3 font-medium">참여</th>
                  <th className="py-2 pr-3 font-medium">발표자 불참</th>
                  <th className="py-2 pr-3 font-medium">일반 불참</th>
                  <th className="py-2 pr-3 font-medium">누적 벌금</th>
                  <th className="py-2 pr-3 font-medium">납부</th>
                  <th className="py-2 font-medium">미납</th>
                </tr>
              </thead>
              <tbody>
                {fines.members.map((m) => {
                  // 편집 중엔 초안 값으로 파생해 즉시 재계산(누적/미납은 읽기 전용).
                  const d = ledgerEditing ? ledgerDraft[m.memberId] : undefined;
                  const row: LedgerDraftRow = d ?? {
                    count: m.count,
                    missedPresenter: m.missedPresenter,
                    missedAbsent: m.missedAbsent,
                    paid: m.paid,
                  };
                  const { accruedFine, outstanding } = deriveFineSummary(
                    { memberId: m.memberId, ...row },
                    fines.finePresenter,
                    fines.fineAbsent,
                  );
                  const unpaid = outstanding > 0;
                  return (
                    <tr
                      key={m.memberId}
                      className="border-t border-border-token"
                    >
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-1.5">
                          <Avatar user={m} size="sm" />
                          <span className="text-fg">{m.name}</span>
                        </span>
                      </td>
                      <LedgerCell
                        editing={ledgerEditing}
                        value={row.count}
                        suffix="회"
                        ariaLabel={`${m.name} 참여`}
                        onChange={(v) => setDraftField(m.memberId, "count", v)}
                      />
                      <LedgerCell
                        editing={ledgerEditing}
                        value={row.missedPresenter}
                        suffix="회"
                        ariaLabel={`${m.name} 발표자 불참`}
                        onChange={(v) =>
                          setDraftField(m.memberId, "missedPresenter", v)
                        }
                      />
                      <LedgerCell
                        editing={ledgerEditing}
                        value={row.missedAbsent}
                        suffix="회"
                        ariaLabel={`${m.name} 일반 불참`}
                        onChange={(v) =>
                          setDraftField(m.memberId, "missedAbsent", v)
                        }
                      />
                      {/* 누적 벌금은 파생 — 편집 불가(읽기 전용, DB.md) */}
                      <td className="py-2 pr-3 font-mono text-fg">
                        {won(accruedFine)}
                      </td>
                      <LedgerCell
                        editing={ledgerEditing}
                        value={row.paid}
                        money
                        ariaLabel={`${m.name} 납부`}
                        onChange={(v) => setDraftField(m.memberId, "paid", v)}
                      />
                      {/* 미납도 파생 — 편집 불가. 색에만 의존하지 않게 텍스트로도 구분(R29) */}
                      <td className="py-2">
                        {unpaid ? (
                          <span className="font-mono font-medium text-busy">
                            {won(outstanding)}
                          </span>
                        ) : (
                          <Badge className="bg-bg-subtle text-fg-muted">
                            완납
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ledgerError && (
            <p role="alert" className="text-[12px] text-busy">
              {ledgerError}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

// 장부 셀 — 편집 모드면 숫자 입력(원자료), 아니면 읽기 전용 표시. 누적/미납엔 쓰지 않는다(파생).
function LedgerCell({
  editing,
  value,
  ariaLabel,
  onChange,
  suffix,
  money,
}: {
  editing: boolean;
  value: number;
  ariaLabel: string;
  onChange: (n: number) => void;
  suffix?: string;
  money?: boolean;
}) {
  if (editing) {
    return (
      <td className="py-2 pr-3">
        <input
          type="number"
          min={0}
          value={value}
          aria-label={ariaLabel}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 rounded-sm border border-border-strong bg-bg-elevated px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
        />
      </td>
    );
  }
  return (
    <td className={`py-2 pr-3 ${money ? "font-mono text-fg-muted" : "text-fg-muted"}`}>
      {money ? won(value) : `${value}${suffix ?? ""}`}
    </td>
  );
}

function FineItem({
  label,
  desc,
  amount,
  editing,
  value,
  onChange,
  ariaLabel,
}: {
  label: string;
  desc: string;
  amount: number;
  editing: boolean;
  value: number;
  onChange: (n: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-bg-subtle px-3 py-2.5">
      <span className="text-[12px] font-medium text-fg-muted">{label}</span>
      {editing ? (
        <span className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            step={1000}
            value={value}
            aria-label={ariaLabel}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-32 rounded-sm border border-border-strong bg-bg-elevated px-2 py-1 font-mono text-[13px] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
          />
          <span className="text-[13px] text-fg-muted">원</span>
        </span>
      ) : (
        <span className="font-mono text-[15px] font-semibold text-fg">
          {won(amount)}
        </span>
      )}
      <span className="text-[11px] text-fg-subtle">{desc}</span>
    </div>
  );
}
