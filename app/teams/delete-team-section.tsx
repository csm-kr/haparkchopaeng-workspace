"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@/components/ui";
import { deleteTeamAction } from "./actions";

// 팀 삭제 섹션 — 인터랙티브 섬(ADR-015). 쓰기는 Server Action(deleteTeamAction).
// CRITICAL: 표시되는 팀 목록은 서버가 권한으로 계산해 props로 준다(관리자=전체/owner=내 팀). UI는 보조, 서버가 최종(R19).
// CRITICAL: 파괴적이라 팀 이름 타이핑 확인을 거친다(R27) — 입장 picker와 분리해 오삭제를 막는다.

export interface DeleteTeamSectionProps {
  teams: { slug: string; name: string }[];
}

export function DeleteTeamSection({ teams }: DeleteTeamSectionProps) {
  const router = useRouter();
  const [target, setTarget] = React.useState<{ slug: string; name: string } | null>(null);
  const [confirmText, setConfirmText] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (teams.length === 0) return null;

  function openDialog(team: { slug: string; name: string }) {
    setTarget(team);
    setConfirmText("");
    setError(null);
  }

  async function confirmDelete() {
    if (!target || confirmText !== target.name) return;
    setDeleting(true);
    setError(null);
    const result = await deleteTeamAction(target.slug);
    if (!result.ok) {
      setError(result.message);
      setDeleting(false);
      return;
    }
    setDeleting(false);
    setTarget(null);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2 border-t border-border-token pt-5">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">팀 삭제</h2>
      <ul aria-label="삭제 가능한 팀" className="flex flex-col gap-2">
        {teams.map((t) => (
          <li
            key={t.slug}
            className="flex items-center justify-between gap-3 rounded-md border border-border-token px-3.5 py-3"
          >
            <span className="truncate text-[14px] font-medium text-fg">{t.name}</span>
            <Button
              variant="danger"
              size="sm"
              onClick={() => openDialog(t)}
              aria-label={`${t.name} 삭제`}
            >
              삭제
            </Button>
          </li>
        ))}
      </ul>

      {target && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--fg)_28%,transparent)] p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setTarget(null);
          }}
        >
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="팀 삭제 확인"
            className="flex w-full max-w-sm flex-col gap-3 p-5"
          >
            <p className="text-[15px] font-semibold text-fg">{target.name} 팀을 삭제할까요?</p>
            <p className="text-[13px] text-fg-muted">
              이 팀의 논문·발표·일정·벌금·라이브 기록이 모두 영구 삭제돼요. 되돌릴 수 없어요.
            </p>
            <label className="flex flex-col gap-1 text-[12px] text-fg-subtle">
              확인을 위해 팀 이름 <b className="text-fg">{target.name}</b> 을(를) 입력하세요
              <Input
                aria-label="삭제 확인 팀 이름"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-[12px] text-busy">
                {error}
              </p>
            )}
            <div className="mt-1 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setTarget(null)}>
                취소
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={confirmDelete}
                disabled={deleting || confirmText !== target.name}
              >
                {deleting ? "삭제 중…" : "영구 삭제"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}
