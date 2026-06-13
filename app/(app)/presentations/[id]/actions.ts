"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import type { CommentView, ReactionView } from "@/components/presentations";

// 댓글/반응 쓰기 — Server Action(쓰기는 Server Action/route handler, ADR-015/R32).
// CRITICAL: 작성자(authorId)·반응 주체(memberId)는 세션에서 주입한다 — 클라가 보낸 값은 받지 않는다(R3/SECURITY).
// CRITICAL: 댓글은 발표 자료에 귀속된다 — 논문 상세엔 댓글이 없다(ADR-004/R9).

interface MemberRow {
  id: string;
  name: string;
  handle: string;
  initial: string;
  color: string;
}

function toRef(m: MemberRow | undefined): {
  id: string;
  name: string;
  handle: string;
  initial: string;
  color: string;
} | null {
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    handle: m.handle,
    initial: m.initial,
    color: m.color,
  };
}

const AddCommentSchema = z.object({
  presentationId: z.string().min(1),
  body: z.string().trim().min(1),
  slide: z.number().int().positive().nullable(),
});

export async function addComment(input: {
  presentationId: string;
  body: string;
  slide: number | null;
}): Promise<CommentView> {
  const session = await requireAuth();
  const parsed = AddCommentSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, "BAD_REQUEST", "내용을 입력해주세요.");
  }
  const { presentationId, body, slide } = parsed.data;

  // @멘션은 본문에 토큰으로 보존한다(파싱·링크화는 렌더 시점, 알림 트리거는 미결 I-5).
  const comment = await prisma.comment.create({
    data: { presentationId, authorId: session.memberId, body, slide },
  });

  const author = await prisma.member.findUnique({
    where: { id: session.memberId },
    select: { id: true, name: true, handle: true, initial: true, color: true },
  });

  revalidatePath(`/presentations/${presentationId}`);

  return {
    id: comment.id,
    body: comment.body,
    slide: comment.slide,
    createdAt: comment.createdAt.toISOString(),
    author: toRef(author ?? undefined),
    reactions: [],
  };
}

const ToggleReactionSchema = z.object({
  presentationId: z.string().min(1),
  commentId: z.string().min(1),
  emoji: z.string().trim().min(1).max(8),
});

/**
 * 반응 토글 — 내 (commentId, memberId, emoji) 반응이 있으면 제거, 없으면 추가.
 * @@unique([commentId, memberId, emoji])를 토글로 지킨다. 갱신된 반응 목록을 돌려준다.
 */
export async function toggleReaction(input: {
  presentationId: string;
  commentId: string;
  emoji: string;
}): Promise<ReactionView[]> {
  const session = await requireAuth();
  const parsed = ToggleReactionSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, "BAD_REQUEST", "잘못된 요청이에요.");
  }
  const { presentationId, commentId, emoji } = parsed.data;
  const memberId = session.memberId;

  const existing = await prisma.reaction.findUnique({
    where: { commentId_memberId_emoji: { commentId, memberId, emoji } },
  });
  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.reaction.create({ data: { commentId, memberId, emoji } });
  }

  const [reactions, members] = await Promise.all([
    prisma.reaction.findMany({ where: { commentId } }),
    prisma.member.findMany({
      select: { id: true, name: true, handle: true, initial: true, color: true },
    }),
  ]);
  const byId = new Map<string, MemberRow>(members.map((m) => [m.id, m]));

  revalidatePath(`/presentations/${presentationId}`);

  return reactions.map((r) => ({
    id: r.id,
    emoji: r.emoji,
    member: toRef(byId.get(r.memberId)),
  }));
}
