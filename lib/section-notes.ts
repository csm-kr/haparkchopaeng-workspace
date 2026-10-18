import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "./http";
import type { NoteView } from "@/components/analyzer";

export const AddSectionNoteSchema = z.object({ paperId: z.string().min(1), sectionId: z.string().min(1), lens: z.enum(["research", "repro", "any"]), title: z.string().trim().min(1), body: z.string().trim().min(1) });
export type AddSectionNoteInput = z.infer<typeof AddSectionNoteSchema>;
/** Call only after deriving scope at an authenticated server boundary. Shared by human and reviewed agent writes. */
export async function createSectionNote(db: Prisma.TransactionClient, scope: { memberId: string; teamId: string }, input: AddSectionNoteInput): Promise<NoteView> {
  const parsed = AddSectionNoteSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "BAD_REQUEST", "내용을 입력해주세요.");
  const { paperId, sectionId, title, body } = parsed.data;
  const paper = await db.paper.findFirst({ where: { id: paperId, teamId: scope.teamId }, select: { id: true } });
  if (!paper) throw new HttpError(404, "NOT_FOUND", "논문을 찾을 수 없어요.");
  const lens = sectionId === "figures" ? "any" : parsed.data.lens;
  const note = await db.sectionNote.create({ data: { paperId, sectionId, lens, title, body, authorId: scope.memberId } });
  const author = await db.member.findUnique({ where: { id: scope.memberId }, select: { id: true, name: true, initial: true, color: true } });
  return { id: note.id, sectionId: note.sectionId, lens: note.lens as NoteView["lens"], title: note.title, body: note.body, createdAt: note.createdAt.toISOString(), author };
}
