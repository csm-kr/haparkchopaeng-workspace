"use client";

import * as React from "react";
import { Check, Copy, Link2, MoreHorizontal, UserPlus } from "lucide-react";
import { Avatar, Badge, Button, Card, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import type {
  PendingInviteView,
  RemoveActionResult,
  RoleActionResult,
  TeamMemberView,
} from "./types";
import type { Role } from "@/types";

// 팀 관리 — 인터랙티브 섬(ADR-015). 초대 블록 + 멤버 목록 + 대기 초대.
// CRITICAL: 관리 액션(초대·역할 변경·내보내기)은 서버에서 관리자 전용으로 강제된다(👑, R19).
//   여기 UI 게이팅(isAdmin)은 보조일 뿐 신뢰 경계가 아니다. 비관리자에겐 숨기고 안내한다.
// CRITICAL: 내보내기는 확인 다이얼로그(R27). 초대 취소는 즉시 + 되돌리기(R27).
// CRITICAL: 공개 가입 경로를 만들지 않는다 — 합류는 초대 토큰으로만(R18/ADR-007).
// 초대 생성/취소/재전송은 step4의 route handler(/api/invites…)를 그대로 호출한다(R32 섬 fetch 허용).

const ROLES: Role[] = ["관리자", "멤버", "게스트"];

const ROLE_VARIANT: Record<Role, "admin" | "member" | "guest"> = {
  관리자: "admin",
  멤버: "member",
  게스트: "guest",
};

/** 역할 배지 — 색 + 텍스트 병행(R29). */
function RoleBadge({ role }: { role: Role }) {
  return <Badge variant={ROLE_VARIANT[role]}>{role}</Badge>;
}

interface ApiShape<T> {
  data?: T;
  error?: { code: string; message: string };
}

async function callJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const json: ApiShape<T> = await res.json().catch(() => ({}));
  if (!res.ok || !json.data) {
    throw new Error(json.error?.message ?? "요청을 처리하지 못했어요.");
  }
  return json.data;
}

export interface TeamManagerProps {
  members: TeamMemberView[];
  invites: PendingInviteView[];
  currentUserId: string;
  isAdmin: boolean;
  onChangeRole: (input: {
    memberId: string;
    role: Role;
  }) => Promise<RoleActionResult>;
  onRemoveMember: (input: { memberId: string }) => Promise<RemoveActionResult>;
}

export function TeamManager({
  members: initialMembers,
  invites: initialInvites,
  currentUserId,
  isAdmin,
  onChangeRole,
  onRemoveMember,
}: TeamManagerProps) {
  // 마운트 후에는 로컬 상태가 진실 — 낙관적 갱신을 여기서 관리한다.
  const [members, setMembers] = React.useState(initialMembers);
  const [invites, setInvites] = React.useState(initialInvites);

  // 초대 폼
  const [email, setEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<Role>("멤버");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  // 생성/재전송 후 보여줄 초대 링크
  const [shareLink, setShareLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // 멤버 ⋯ 메뉴 / 내보내기 확인 / 되돌리기
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const [removeTarget, setRemoveTarget] =
    React.useState<TeamMemberView | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [undo, setUndo] = React.useState<PendingInviteView | null>(null);

  async function copy(link: string) {
    setShareLink(link);
    setCopied(false);
    try {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
    } catch {
      // 클립보드 미지원 — 링크는 화면에 노출되므로 수동 복사 가능.
    }
  }

  async function sendInvite() {
    const value = email.trim();
    // 검증은 인라인 — 토스트가 아니라 입력 옆 안내(R30).
    if (!value || !value.includes("@")) {
      setFormError("이메일 주소를 확인해주세요.");
      return;
    }
    setSending(true);
    setFormError(null);
    setActionError(null);
    try {
      const { invite, link } = await callJson<{
        invite: PendingInviteView;
        link: string;
      }>("/api/invites", {
        method: "POST",
        body: JSON.stringify({ email: value, role: inviteRole }),
      });
      setInvites((prev) => [
        { id: invite.id, email: invite.email, role: inviteRole, createdAt: invite.createdAt },
        ...prev,
      ]);
      setEmail("");
      await copy(link);
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "초대를 보내지 못했어요.",
      );
    } finally {
      setSending(false);
    }
  }

  async function resend(invite: PendingInviteView) {
    setActionError(null);
    try {
      const { link } = await callJson<{ link: string }>(
        `/api/invites/${invite.id}/resend`,
        { method: "POST" },
      );
      await copy(link);
    } catch {
      setActionError("초대 링크를 다시 만들지 못했어요. 잠깐 후 다시 시도해주세요.");
    }
  }

  async function cancelInvite(invite: PendingInviteView) {
    setActionError(null);
    // 낙관적 제거 + 되돌리기(R27) — 즉시 사라지되 한 번 되돌릴 수 있다.
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    setUndo(invite);
    try {
      await callJson(`/api/invites/${invite.id}`, { method: "DELETE" });
    } catch {
      setInvites((prev) => [invite, ...prev]); // 실패 시 롤백
      setUndo(null);
      setActionError("초대를 취소하지 못했어요. 잠깐 후 다시 시도해주세요.");
    }
  }

  async function undoCancel() {
    if (!undo) return;
    const target = undo;
    setUndo(null);
    try {
      // 되돌리기 = 같은 이메일·역할로 다시 초대(새 토큰). 취소는 비가역이라 재발급한다.
      const { invite } = await callJson<{
        invite: PendingInviteView;
      }>("/api/invites", {
        method: "POST",
        body: JSON.stringify({ email: target.email, role: target.role }),
      });
      setInvites((prev) => [
        { id: invite.id, email: invite.email, role: target.role, createdAt: invite.createdAt },
        ...prev,
      ]);
    } catch {
      setActionError("초대를 되돌리지 못했어요. 다시 초대해주세요.");
    }
  }

  async function changeRole(member: TeamMemberView, role: Role) {
    setMenuFor(null);
    setActionError(null);
    if (role === member.role) return;
    const prev = members;
    // 낙관적 갱신.
    setMembers((curr) =>
      curr.map((m) => (m.id === member.id ? { ...m, role } : m)),
    );
    const result = await onChangeRole({ memberId: member.id, role });
    if (!result.ok) {
      setMembers(prev); // 롤백
      setActionError(result.message);
    } else {
      setMembers((curr) =>
        curr.map((m) => (m.id === member.id ? result.member : m)),
      );
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    setActionError(null);
    const target = removeTarget;
    const result = await onRemoveMember({ memberId: target.id });
    setRemoving(false);
    if (!result.ok) {
      setActionError(result.message);
      setRemoveTarget(null);
      return;
    }
    setMembers((curr) => curr.filter((m) => m.id !== target.id));
    setRemoveTarget(null);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-fg">
          팀 관리
        </h1>
        <p className="text-[13px] text-fg-muted">
          초대 전용 비공개 그룹이에요. 합류는 초대 링크로만 가능해요.
        </p>
      </div>

      {actionError && (
        <p
          role="alert"
          className="rounded-md bg-bg-subtle px-3 py-2 text-[13px] text-busy"
        >
          {actionError}
        </p>
      )}

      {/* 초대 블록 — 관리자만(👑). 비관리자에겐 안내만 보인다(R19). */}
      {isAdmin ? (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-[20px] font-semibold text-fg">멤버 초대</h2>
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="초대할 이메일"
                placeholder="이메일 주소"
              />
              {formError && (
                <p role="alert" className="text-[12px] text-busy">
                  {formError}
                </p>
              )}
            </div>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              aria-label="초대 역할"
              className="rounded-sm border border-border-strong bg-bg-elevated px-2 py-[9px] text-[13px] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <Button onClick={sendInvite} disabled={sending}>
              <UserPlus size={14} aria-hidden="true" />
              {sending ? "보내는 중…" : "초대 보내기"}
            </Button>
          </div>

          {/* 🔗 초대 링크 복사 — 생성/재전송 후 노출 */}
          {shareLink && (
            <div className="flex items-center gap-2 rounded-md bg-bg-subtle px-3 py-2">
              <Link2 size={14} className="shrink-0 text-fg-subtle" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-muted">
                {shareLink}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => copy(shareLink)}
                aria-label="초대 링크 복사"
              >
                {copied ? (
                  <>
                    <Check size={13} aria-hidden="true" /> 복사됨
                  </>
                ) : (
                  <>
                    <Copy size={13} aria-hidden="true" /> 링크 복사
                  </>
                )}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card className="px-4 py-3 text-[13px] text-fg-subtle">
          멤버 초대·역할 변경은 관리자만 할 수 있어요.
        </Card>
      )}

      {/* 멤버 목록 */}
      <Card className="flex flex-col">
        <div className="border-b border-border-token px-4 py-3">
          <h2 className="text-[20px] font-semibold text-fg">
            멤버 {members.length}명
          </h2>
        </div>
        <ul className="divide-y divide-border-token">
          {members.map((m) => {
            const isSelf = m.id === currentUserId;
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar user={m} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5 text-[14px] font-medium text-fg">
                    {m.name}
                    {isSelf && (
                      <span className="rounded-sm bg-bg-subtle px-1.5 py-0.5 text-[11px] text-fg-subtle">
                        나
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[12px] text-fg-subtle">
                    {m.email}
                  </span>
                </div>
                <RoleBadge role={m.role} />

                {/* ⋯ 메뉴 — 관리자만, 본인 제외(자기 권한 박탈/잠금 방지). */}
                {isAdmin && !isSelf && (
                  <span className="relative">
                    <button
                      type="button"
                      aria-label={`${m.name} 관리 메뉴`}
                      aria-haspopup="menu"
                      aria-expanded={menuFor === m.id}
                      onClick={() =>
                        setMenuFor((id) => (id === m.id ? null : m.id))
                      }
                      className="inline-flex size-8 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                    {menuFor === m.id && (
                      <div
                        role="menu"
                        className="absolute right-0 z-10 mt-1 flex w-44 flex-col rounded-md border border-border-token bg-bg-elevated p-1 shadow-[var(--shadow-lg)]"
                      >
                        <span className="px-2 py-1 text-[11px] font-medium text-fg-subtle">
                          역할 변경
                        </span>
                        {ROLES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            role="menuitem"
                            onClick={() => changeRole(m, r)}
                            className={cn(
                              "flex items-center justify-between rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-bg-hover",
                              r === m.role ? "text-fg" : "text-fg-muted",
                            )}
                          >
                            {r}
                            {r === m.role && (
                              <Check size={13} className="text-accent" aria-hidden="true" />
                            )}
                          </button>
                        ))}
                        <span className="my-1 border-t border-border-token" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuFor(null);
                            setRemoveTarget(m);
                          }}
                          className="rounded-sm px-2 py-1.5 text-left text-[13px] text-busy hover:bg-bg-hover"
                        >
                          내보내기
                        </button>
                      </div>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* 대기 중인 초대 — 점선 행. 관리자만 보인다. */}
      {isAdmin && (invites.length > 0 || undo) && (
        <section aria-label="대기 중인 초대" className="flex flex-col gap-2">
          <h2 className="text-[16px] font-semibold text-fg">대기 중인 초대</h2>

          {undo && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-bg-subtle px-3 py-2 text-[13px] text-fg-muted">
              <span>
                <span className="font-medium text-fg">{undo.email}</span> 초대를
                취소했어요.
              </span>
              <Button variant="ghost" size="sm" onClick={undoCancel}>
                되돌리기
              </Button>
            </div>
          )}

          {invites.length === 0 ? (
            <p className="text-[13px] text-fg-subtle">
              대기 중인 초대가 없어요.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {invites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center gap-3 rounded-md border border-dashed border-border-strong px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-medium text-fg">
                      {inv.email}
                    </span>
                    <span className="text-[11px] text-fg-subtle">초대됨</span>
                  </div>
                  <RoleBadge role={inv.role} />
                  <Button variant="ghost" size="sm" onClick={() => resend(inv)}>
                    재전송
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelInvite(inv)}
                  >
                    취소
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 내보내기 확인 다이얼로그 — 파괴적 액션(R27). 위험 색 버튼(--busy). */}
      {removeTarget && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--fg)_28%,transparent)] p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setRemoveTarget(null);
          }}
        >
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="멤버 내보내기 확인"
            className="flex w-full max-w-sm flex-col gap-3 p-5"
          >
            <p className="text-[15px] font-semibold text-fg">
              {removeTarget.name}님을 내보낼까요?
            </p>
            <p className="text-[13px] text-fg-muted">
              내보낸 멤버는 더 이상 워크스페이스에 접근할 수 없어요. 다시
              초대하면 합류할 수 있어요.
            </p>
            <div className="mt-1 flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRemoveTarget(null)}
              >
                취소
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={confirmRemove}
                disabled={removing}
              >
                {removing ? "내보내는 중…" : "내보내기"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
