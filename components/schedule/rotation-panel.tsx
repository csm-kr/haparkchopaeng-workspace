"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, ChevronUp, Pencil } from "lucide-react";
import { Avatar, Button, Card } from "@/components/ui";
import type { MemberOption } from "./types";

// 로테이션 편성(SCREENS §schedule) — 발표 순번(iteration)을 관리자가 정한다.
// 순서를 정하지 않으면 가입순으로 배정된다(lib/schedule.ts의 정렬).
// CRITICAL: 편성(rotationOrder 저장)은 관리자만(👑, SECURITY). 권한 없는 액션은 노출하지 않는다(R19).

export interface RotationPanelProps {
  members: MemberOption[];
  isAdmin: boolean;
  onReorder: (orderedIds: string[]) => Promise<MemberOption[]>;
}

export function RotationPanel({
  members: initial,
  isAdmin,
  onReorder,
}: RotationPanelProps) {
  const [members, setMembers] = React.useState<MemberOption[]>(initial);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<MemberOption[]>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 서버에서 새 순서가 내려오면(갱신) 반영.
  React.useEffect(() => {
    setMembers(initial);
  }, [initial]);

  function startEdit() {
    setDraft(members);
    setError(null);
    setEditing(true);
  }

  function move(index: number, dir: -1 | 1) {
    setDraft((cur) => {
      const next = cur.slice();
      const j = index + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await onReorder(draft.map((m) => m.id));
      setMembers(updated);
      setEditing(false);
    } catch {
      setError("저장하지 못했어요. 잠깐 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-semibold text-fg">로테이션</h2>
        {/* 편성은 관리자 + 멤버 2명 이상일 때만 의미 있음 */}
        {isAdmin &&
          members.length > 1 &&
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
              <Pencil size={13} aria-hidden="true" /> 편성
            </Button>
          ))}
      </div>

      {members.length === 0 ? (
        <p className="text-[13px] text-fg-subtle">
          아직 멤버가 없어요. 팀에서 초대하면 로테이션에 나타나요.
        </p>
      ) : editing ? (
        <ul className="flex flex-col gap-1.5">
          {draft.map((m, i) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-md bg-bg-subtle px-2 py-1.5"
            >
              <span className="inline-flex items-center gap-2 text-[13px] text-fg">
                <span className="w-4 text-right font-mono text-[11px] text-fg-subtle">
                  {i + 1}
                </span>
                <Avatar user={m} size="sm" /> {m.name}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`${m.name} 위로`}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => move(i, 1)}
                  disabled={i === draft.length - 1}
                  aria-label={`${m.name} 아래로`}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {members.map((m, i) => (
            <React.Fragment key={m.id}>
              {i > 0 && (
                <ChevronRight
                  size={13}
                  className="text-fg-faint"
                  aria-hidden="true"
                />
              )}
              <span className="inline-flex items-center gap-1.5 rounded-md bg-bg-subtle px-2 py-1 text-[12px] text-fg">
                <Avatar user={m} size="sm" /> {m.name}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[12px] text-busy">
          {error}
        </p>
      )}
      <p className="text-[12px] text-fg-subtle">
        이 순서대로 발표가 순환해요. 순서를 정하지 않으면 가입순으로 배정돼요.
      </p>
    </Card>
  );
}
