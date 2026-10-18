"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { HttpError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import type { NoteView } from "@/components/analyzer";
import type { NoteLens } from "@/types";
import { AddSectionNoteSchema, createSectionNote } from "@/lib/section-notes";

// 노트 쓰기 — Server Action(쓰기는 Server Action/route handler, ADR-015/R32).
// CRITICAL: 작성자(authorId)는 세션에서 주입한다 — 클라가 보낸 값은 받지 않는다(R3/SECURITY).
// CRITICAL: 부모 Paper가 활성 팀 것일 때만 — 교차 팀 변이는 404(R37/R19/ADR-020).
// CRITICAL: sectionId==='figures'면 lens='any'로 강제한다(ADR-005/R11).

export async function addNote(input: {
  paperId: string;
  sectionId: string;
  lens: NoteLens;
  title: string;
  body: string;
}): Promise<NoteView> {
  const session = await requireAuth();
  const parsed = AddSectionNoteSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, "BAD_REQUEST", "내용을 입력해주세요.");
  }
  const team = await getActiveTeam(session.memberId);
  if (!team) throw new HttpError(404, "NOT_FOUND", "논문을 찾을 수 없어요.");
  const note = await createSectionNote(prisma, { memberId: session.memberId, teamId: team.id }, parsed.data);
  revalidatePath(`/papers/${parsed.data.paperId}`);
  return note;
}

const DeleteNoteSchema = z.object({
  noteId: z.string().min(1),
  paperId: z.string().min(1),
});

export async function deleteNote(input: {
  noteId: string;
  paperId: string;
}): Promise<void> {
  const session = await requireAuth();
  const parsed = DeleteNoteSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, "BAD_REQUEST", "잘못된 요청이에요.");
  }

  const note = await prisma.sectionNote.findUnique({
    where: { id: parsed.data.noteId },
    include: { paper: { select: { teamId: true } } },
  });
  if (!note) throw new HttpError(404, "NOT_FOUND", "노트를 찾을 수 없어요.");

  // 노트의 부모 논문이 활성 팀 것인지 확인(R37/R19) — 권한 체크 전에 막는다(교차 팀 차단).
  const team = await getActiveTeam(session.memberId);
  if (!team || note.paper.teamId !== team.id) {
    throw new HttpError(404, "NOT_FOUND", "노트를 찾을 수 없어요.");
  }

  // ✍️ 작성자 본인 또는 관리자만 삭제(SECURITY 인가 표).
  if (note.authorId !== session.memberId && session.role !== "관리자") {
    throw new HttpError(403, "FORBIDDEN", "이 노트는 삭제할 권한이 없어요.");
  }

  await prisma.sectionNote.delete({ where: { id: note.id } });
  revalidatePath(`/papers/${parsed.data.paperId}`);
}
