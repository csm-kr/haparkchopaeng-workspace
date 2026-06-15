"use client";

import * as React from "react";
import { Check, Copy, Link2, MoreHorizontal } from "lucide-react";
import { Avatar, Badge, Button, Card, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { PendingInviteView, TeamMemberView } from "./types";
import type { BadgeVariant } from "@/components/ui";
import type { InviteRole, TeamRole } from "@/types";

// 팀 관리 — 인터랙티브 섬(ADR-015). 멤버 목록 + 토큰 초대 발급/회수 + 역할 변경/내보내기.
// CRITICAL: 관리 액션(초대 발급·회수·역할 변경·내보내기)은 서버 route handler가 최종 강제(R19). UI 게이팅은 보조.
// CRITICAL: 합류는 초대 토큰으로만 — 공개 가입(자동 팀 배정) 경로를 만들지 않는다(R18/ADR-018).
// CRITICAL: 역할 표기는 영어 그대로(owner/admin/member). 한국어(팀장/관리자/팀원)로 번역하지 않는다(사용자 지시).
// CRITICAL: owner는 초대로 부여 불가·강등/추방 불가(팀당 owner ≥ 1).

// owner = 액센트(가장 강조), admin = 액센트 틴트, member = 중립. 토큰만(R20)·텍스트 병행(R29).
const ROLE_VARIANT: Record<TeamRole, BadgeVariant> = {
  owner: "owner",
  admin: "admin",
  member: "member",
};

/** 초대로 부여 가능한 역할(owner 제외, ADR-018). 역할 변경 메뉴에도 같은 집합을 쓴다. */
const ASSIGNABLE_ROLES: InviteRole[] = ["admin", "member"];

function RoleBadge({ role }: { role: TeamRole }) {
  return <Badge variant={ROLE_VARIANT[role]}>{role}</Badge>;
}

interface ApiShape<T> {
  data?: T;
  error?: { code: string; message: string };
}

async function callJson<T>(input: string, init?: RequestInit): Promise<T> {
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

/** POST /api/invites 응답의 raw invite(Date는 JSON 직렬화로 문자열). */
interface RawInvite {
  id: string;
  role: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
}

function toInviteRole(value: string): InviteRole {
  return value === "admin" ? "admin" : "member";
}

export interface TeamManagerProps {
  teamSlug: string;
  members: TeamMemberView[];
  invites: PendingInviteView[];
  currentUserId: string;
  /** 보는 사람의 팀 멤버십 역할 — 관리 UI 게이팅(보조). 서버가 최종 강제(R19). */
  currentUserRole: TeamRole;
}

export function TeamManager({
  teamSlug,
  members: initialMembers,
  invites: initialInvites,
  currentUserId,
  currentUserRole,
}: TeamManagerProps) {
  const [members, setMembers] = React.useState(initialMembers);
  const [invites, setInvites] = React.useState(initialInvites);

  const isOwner = currentUserRole === "owner";
  const isAdmin = currentUserRole === "admin";
  const canManage = isOwner || isAdmin;

  // 초대 발급 폼
  const [inviteRole, setInviteRole] = React.useState<InviteRole>("member");
  const [maxUses, setMaxUses] = React.useState("1");
  const [generating, setGenerating] = React.useState(false);
  const [inviteError, setInviteError] = React.useState<string | null>(null);

  // 생성/회수 후 보여줄 초대 링크
  const [shareLink, setShareLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // 멤버 ⋯ 메뉴 / 내보내기 확인
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<TeamMemberView | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // 보호 규칙(서버가 최종 강제 — 여기선 게이팅만).
  const canChangeRole = (t: TeamMemberView) => isOwner && t.role !== "owner";
  const canRemove = (t: TeamMemberView) => {
    if (t.role === "owner") return false; // owner는 추방 불가(팀당 owner ≥ 1)
    if (isOwner) return true;
    if (isAdmin) return t.role === "member";
    return false;
  };
  const hasMenu = (t: TeamMemberView, isSelf: boolean) =>
    !isSelf && (canChangeRole(t) || canRemove(t));

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

  async function createInviteLink() {
    setInviteError(null);
    setGenerating(true);
    const uses = Math.max(1, Math.floor(Number(maxUses)) || 1);
    try {
      const { invite, link } = await callJson<{ invite: RawInvite; link: string }>(
        "/api/invites",
        {
          method: "POST",
          body: JSON.stringify({ teamSlug, role: inviteRole, maxUses: uses }),
        },
      );
      await copy(link);
      // 새 초대를 활성 목록 맨 위에 낙관적으로 추가.
      setInvites((prev) => [
        {
          id: invite.id,
          role: toInviteRole(invite.role),
          maxUses: invite.maxUses,
          usedCount: invite.usedCount,
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt,
        },
        ...prev,
      ]);
    } catch (e) {
      setInviteError(
        e instanceof Error ? e.message : "초대 링크를 만들지 못했어요. 잠깐 후 다시 시도해주세요.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function revokeInvite(invite: PendingInviteView) {
    setActionError(null);
    // 낙관적 제거 — 실패 시 롤백(R27).
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    try {
      await callJson(`/api/invites/${invite.id}`, { method: "DELETE" });
    } catch {
      setInvites((prev) => [invite, ...prev]);
      setActionError("초대를 회수하지 못했어요. 잠깐 후 다시 시도해주세요.");
    }
  }

  async function changeRole(member: TeamMemberView, role: InviteRole) {
    setMenuFor(null);
    setActionError(null);
    if (role === member.role) return;
    const prev = members;
    setMembers((curr) => curr.map((m) => (m.id === member.id ? { ...m, role } : m)));
    try {
      await callJson(`/api/teams/${teamSlug}/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
    } catch (e) {
      setMembers(prev); // 롤백
      setActionError(e instanceof Error ? e.message : "역할을 바꾸지 못했어요.");
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    setActionError(null);
    const target = removeTarget;
    try {
      await callJson(`/api/teams/${teamSlug}/members/${target.id}`, { method: "DELETE" });
      setMembers((curr) => curr.filter((m) => m.id !== target.id));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "멤버를 내보내지 못했어요.");
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
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

      {/* 초대 링크 만들기 — owner·admin만. owner 역할은 부여 불가(ADR-018). */}
      {canManage ? (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-[16px] font-semibold text-fg">초대 링크 만들기</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-fg-subtle">
              역할
              <select
                aria-label="초대 역할"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                className="rounded-sm border border-border-strong bg-bg-elevated px-2.5 py-[7px] text-[13px] text-fg focus:border-accent focus:ring-[3px] focus:ring-accent-soft focus:outline-none"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-24 flex-col gap-1 text-[12px] text-fg-subtle">
              사용 횟수
              <Input
                aria-label="사용 횟수"
                type="number"
                min={1}
                max={100}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </label>
            <Button onClick={createInviteLink} disabled={generating}>
              {generating ? "만드는 중…" : "초대 링크 만들기"}
            </Button>
          </div>
          {inviteError && (
            <p role="alert" className="text-[12px] text-busy">
              {inviteError}
            </p>
          )}
        </Card>
      ) : (
        <Card className="px-4 py-3 text-[13px] text-fg-subtle">
          멤버 초대·역할 변경은 owner·admin만 할 수 있어요.
        </Card>
      )}

      {/* 🔗 생성된 초대 링크 */}
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

      {/* 멤버 목록 */}
      <Card className="flex flex-col">
        <div className="border-b border-border-token px-4 py-3">
          <h2 className="text-[20px] font-semibold text-fg">멤버 {members.length}명</h2>
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
                  <span className="truncate text-[12px] text-fg-subtle">{m.email}</span>
                </div>
                <RoleBadge role={m.role} />

                {hasMenu(m, isSelf) && (
                  <span className="relative">
                    <button
                      type="button"
                      aria-label={`${m.name} 관리 메뉴`}
                      aria-haspopup="menu"
                      aria-expanded={menuFor === m.id}
                      onClick={() => setMenuFor((id) => (id === m.id ? null : m.id))}
                      className="inline-flex size-8 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                    {menuFor === m.id && (
                      <div
                        role="menu"
                        className="absolute right-0 z-10 mt-1 flex w-44 flex-col rounded-md border border-border-token bg-bg-elevated p-1 shadow-[var(--shadow-lg)]"
                      >
                        {canChangeRole(m) && (
                          <>
                            <span className="px-2 py-1 text-[11px] font-medium text-fg-subtle">
                              역할 변경
                            </span>
                            {ASSIGNABLE_ROLES.map((r) => (
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
                          </>
                        )}
                        {canChangeRole(m) && canRemove(m) && (
                          <span className="my-1 border-t border-border-token" />
                        )}
                        {canRemove(m) && (
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
                        )}
                      </div>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* 활성 초대 — 점선 행. owner·admin만. 역할·사용 횟수 표기(이메일 없음 — ADR-018). */}
      {canManage && invites.length > 0 && (
        <section aria-label="대기 중인 초대" className="flex flex-col gap-2">
          <h2 className="text-[16px] font-semibold text-fg">대기 중인 초대</h2>
          <ul className="flex flex-col gap-2">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center gap-3 rounded-md border border-dashed border-border-strong px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] font-medium text-fg">{inv.role}</span>
                  <span className="text-[11px] text-fg-subtle">
                    {inv.usedCount}/{inv.maxUses} 사용됨
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => revokeInvite(inv)}>
                  회수
                </Button>
              </li>
            ))}
          </ul>
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
              내보낸 멤버는 더 이상 이 팀에 접근할 수 없어요. 다시 초대하면 합류할 수 있어요.
            </p>
            <div className="mt-1 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRemoveTarget(null)}>
                취소
              </Button>
              <Button variant="danger" size="sm" onClick={confirmRemove} disabled={removing}>
                {removing ? "내보내는 중…" : "내보내기"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
