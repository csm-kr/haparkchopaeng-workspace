"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { Avatar, Badge, Button, Card } from "@/components/ui";
import { deriveFineSummary } from "@/lib/schedule-logic";
import type { FinesView } from "./types";

// 벌금 설정 + 로테이션 + 연도별 멤버 현황 표(SCREENS §schedule).
// CRITICAL: 누적 벌금·미납은 저장하지 않고 화면에서 파생(DB.md). 벌금 수정은 관리자만(👑, SECURITY).
// 한 섬에 모아 — 벌금 금액을 바꾸면 표가 즉시 재계산되도록(R26/요구사항).

const wonFmt = new Intl.NumberFormat("ko-KR");
function won(n: number): string {
  return `${wonFmt.format(n)}원`;
}

export interface FinesPanelProps {
  fines: FinesView | null;
  isAdmin: boolean;
  onUpdate: (input: {
    year: number;
    finePresenter: number;
    fineAbsent: number;
  }) => Promise<FinesView>;
}

export function FinesPanel({
  fines: initial,
  isAdmin,
  onUpdate,
}: FinesPanelProps) {
  const [fines, setFines] = React.useState<FinesView | null>(initial);
  const [editing, setEditing] = React.useState(false);
  const [presenterAmt, setPresenterAmt] = React.useState(
    initial?.finePresenter ?? 0,
  );
  const [absentAmt, setAbsentAmt] = React.useState(initial?.fineAbsent ?? 0);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
          <p className="text-[13px] text-fg-subtle">
            이 해의 벌금 설정이 아직 없어요.
          </p>
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

      {/* 연도별 멤버 현황 — 누적/미납은 현재 벌금값으로 파생 계산 */}
      {fines && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[20px] font-semibold text-fg">
              {fines.year} 멤버 현황
            </h2>
            <span className="font-mono text-[11px] text-fg-subtle">
              발표자 {won(fines.finePresenter)} · 일반 {won(fines.fineAbsent)}
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
                  const { accruedFine, outstanding } = deriveFineSummary(
                    m,
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
                      <td className="py-2 pr-3 text-fg-muted">{m.count}회</td>
                      <td className="py-2 pr-3 text-fg-muted">
                        {m.missedPresenter}회
                      </td>
                      <td className="py-2 pr-3 text-fg-muted">
                        {m.missedAbsent}회
                      </td>
                      <td className="py-2 pr-3 font-mono text-fg">
                        {won(accruedFine)}
                      </td>
                      <td className="py-2 pr-3 font-mono text-fg-muted">
                        {won(m.paid)}
                      </td>
                      {/* 색에만 의존하지 않게 미납은 텍스트로도 구분(R29) */}
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
        </Card>
      )}
    </div>
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
