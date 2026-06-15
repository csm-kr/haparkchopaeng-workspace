import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import type { InviteRole, InviteStatus } from "@/types";

// 초대 토큰 도메인 (서버 전용, ADR-018). 합류는 랜덤 토큰 + DB 조회로만 — 이메일 매칭·서명 JWT 폐기.
// CRITICAL: 토큰은 추측 불가한 랜덤값(서명 JWT로 회귀 금지). 합류는 acceptInvite(트랜잭션)만 Membership을 쓴다.
// 권한(누가 발급/회수하나)은 route handler 진입부에서 멤버십 역할로 강제한다(R19) — 여기는 도메인만.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일

/** 추측 불가한 초대 토큰. 144비트 엔트로피(base64url 24자). */
export function generateInviteToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

/** 초대 수락 링크. APP_BASE_URL은 서버에서만 읽는다(R2). */
export function inviteLink(token: string): string {
  const base = process.env.APP_BASE_URL ?? "";
  return `${base}/invite/${token}`;
}

/** 초대 발급. 토큰 생성 + 만료(+7일) + insert. createdBy는 호출부(세션)에서(R3). */
export async function createInvite(input: {
  teamId: string;
  role: InviteRole;
  maxUses?: number;
  createdBy: string;
}) {
  return prisma.invite.create({
    data: {
      teamId: input.teamId,
      token: generateInviteToken(),
      role: input.role,
      maxUses: input.maxUses ?? 1,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdBy: input.createdBy,
    },
  });
}

/** 표시용 프리뷰 — 토큰 자체는 재반환하지 않는다(베어러 자격증명 비노출). status는 파생. */
export type InvitePreview =
  | { status: "not_found" }
  | {
      status: Exclude<InviteStatus, "not_found">;
      teamName: string;
      teamSlug: string;
      role: InviteRole;
      expiresAt: string;
      revokedAt: string | null;
      usedCount: number;
      maxUses: number;
    };

/** status 파생: revoked → expired → used_up → ready(순서대로 첫 일치). */
function deriveStatus(invite: {
  revokedAt: Date | null;
  expiresAt: Date;
  usedCount: number;
  maxUses: number;
}): Exclude<InviteStatus, "not_found"> {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() < Date.now()) return "expired";
  if (invite.usedCount >= invite.maxUses) return "used_up";
  return "ready";
}

export async function getInviteForAcceptance(token: string): Promise<InvitePreview> {
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { team: true },
  });
  if (!invite || !invite.team) return { status: "not_found" };
  return {
    status: deriveStatus(invite),
    teamName: invite.team.name,
    teamSlug: invite.team.slug,
    role: toInviteRole(invite.role),
    expiresAt: invite.expiresAt.toISOString(),
    revokedAt: invite.revokedAt ? invite.revokedAt.toISOString() : null,
    usedCount: invite.usedCount,
    maxUses: invite.maxUses,
  };
}

/** DB의 role(String)을 InviteRole로 좁힌다(발급 시 admin|member만 허용되므로 owner는 안 온다). */
function toInviteRole(value: string): InviteRole {
  return value === "admin" ? "admin" : "member";
}

/** 팀 관리 화면의 활성 초대 행(점선). 토큰은 노출하지 않는다(목록엔 베어러 자격증명 비포함). */
export interface ActiveInviteRow {
  id: string;
  role: InviteRole;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
}

/**
 * 한 팀의 활성 초대 목록 — 회수 안 됨 + 미만료 + 사용 여력 있음. 최근 발급 순.
 * (usedCount<maxUses는 컬럼 비교라 JS에서 거른다 — GET /api/invites와 동일 규칙.)
 */
export async function listActiveInvites(teamId: string): Promise<ActiveInviteRow[]> {
  const invites = await prisma.invite.findMany({
    where: { teamId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return invites
    .filter((i) => i.usedCount < i.maxUses)
    .map((i) => ({
      id: i.id,
      role: toInviteRole(i.role),
      maxUses: i.maxUses,
      usedCount: i.usedCount,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
}

interface LockedInviteRow {
  id: string;
  teamId: string;
  role: string;
  maxUses: number;
  usedCount: number;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AcceptResult {
  teamSlug: string;
  alreadyMember: boolean;
}

/**
 * 초대 수락 = 팀 합류(원자적 트랜잭션). 동시 수락은 SELECT … FOR UPDATE로 직렬화한다.
 * 검사: not_found → revoked → expired → (멱등) → used_up. 멱등은 used_up보다 먼저 —
 * 이미 멤버면 소진 여부와 무관하게 사용 소모 없이 성공시킨다(재방문 안전).
 * 실패는 HttpError(code: not_found|revoked|expired|used_up)로 던져 UI가 사람말로 번역(R30).
 */
export async function acceptInvite(input: {
  token: string;
  memberId: string;
}): Promise<AcceptResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedInviteRow[]>`
      SELECT "id", "teamId", "role", "maxUses", "usedCount", "expiresAt", "revokedAt"
      FROM "Invite" WHERE "token" = ${input.token} FOR UPDATE
    `;
    const invite = rows[0];
    if (!invite) throw new HttpError(404, "not_found", "초대를 찾을 수 없어요.");

    if (invite.revokedAt) throw new HttpError(410, "revoked", "회수된 초대예요.");
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new HttpError(410, "expired", "초대 링크가 만료되었어요.");
    }

    const team = await tx.team.findUnique({ where: { id: invite.teamId } });
    if (!team) throw new HttpError(404, "not_found", "초대를 찾을 수 없어요.");

    // 멱등 — 이미 그 팀 멤버면 사용 소모 없이 성공.
    const existing = await tx.membership.findUnique({
      where: { teamId_memberId: { teamId: invite.teamId, memberId: input.memberId } },
    });
    if (existing) return { teamSlug: team.slug, alreadyMember: true };

    if (invite.usedCount >= invite.maxUses) {
      throw new HttpError(409, "used_up", "이 초대는 모두 사용되었어요.");
    }

    const role = toInviteRole(invite.role);
    await tx.membership.create({
      data: { teamId: invite.teamId, memberId: input.memberId, role },
    });
    // 합류 감사(같은 초대로 한 멤버 중복 기록 방지 — onConflict do nothing).
    await tx.teamInviteAcceptance.upsert({
      where: { inviteId_memberId: { inviteId: invite.id, memberId: input.memberId } },
      create: {
        inviteId: invite.id,
        teamId: invite.teamId,
        memberId: input.memberId,
        acceptedRole: role,
      },
      update: {},
    });
    await tx.invite.update({
      where: { id: invite.id },
      data: {
        usedCount: invite.usedCount + 1,
        ...(invite.usedCount === 0 ? { usedAt: new Date() } : {}),
      },
    });

    return { teamSlug: team.slug, alreadyMember: false };
  });
}
