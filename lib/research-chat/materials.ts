import type { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http";
import { MaterialSelectionSchema } from "./validation";
import type { ResearchPresentationOption } from "@/types/research-chat";

export interface MaterialSelection { paperIds: string[]; presentationIds: string[] }

/** Existing conversations store an array; v2 adds seminars without a DB migration. */
export function readSelection(value: Prisma.JsonValue): MaterialSelection {
  const candidate = Array.isArray(value) ? { paperIds: value } : value && typeof value === "object" && value.version === 2
    ? { paperIds: value.paperIds, presentationIds: value.presentationIds } : null;
  const parsed = MaterialSelectionSchema.safeParse(candidate);
  if (!parsed.success) throw new HttpError(409, "INVALID_MATERIALS", "대화에 첨부할 자료를 다시 선택해주세요.");
  return { paperIds: parsed.data.paperIds ?? [], presentationIds: parsed.data.presentationIds ?? [] };
}

export function initialSelection(value: Prisma.JsonValue): MaterialSelection {
  if (value && !Array.isArray(value) && typeof value === "object" && value.version === 2 && value.initial) {
    return readSelection({ version: 2, ...(typeof value.initial === "object" && !Array.isArray(value.initial) ? value.initial : {}) });
  }
  return readSelection(value);
}

export function storeSelection(selection: MaterialSelection, initial: MaterialSelection = selection): Prisma.InputJsonValue {
  return { version: 2, paperIds: selection.paperIds, presentationIds: selection.presentationIds, initial: { paperIds: initial.paperIds, presentationIds: initial.presentationIds } };
}

export async function selectedPapers(db: Prisma.TransactionClient, teamId: string, ids: string[], { allowMissing = false }: { allowMissing?: boolean } = {}) {
  if (!ids.length) return [];
  const rows = await db.paper.findMany({ where: { id: { in: ids }, teamId }, select: { id: true, title: true, sourceText: true, analysisError: true } });
  if (!allowMissing && rows.length !== ids.length) throw new HttpError(404, "PAPER_NOT_FOUND", "이 팀에서 선택한 논문을 찾을 수 없어요.");
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.flatMap(id => { const row = byId.get(id); return row ? [row] : []; });
}

export async function selectedPresentations(db: Prisma.TransactionClient, teamId: string, ids: string[], { allowMissing = false }: { allowMissing?: boolean } = {}) {
  if (!ids.length) return [];
  const rows = await db.presentation.findMany({ where: { id: { in: ids }, teamId }, select: {
    id: true, title: true, date: true, summary: true, keypoints: true, slides: true,
    assets: { where: { type: "pdf" }, select: { id: true, url: true }, orderBy: { id: "asc" }, take: 1 },
  } });
  if (!allowMissing && rows.length !== ids.length) throw new HttpError(404, "PRESENTATION_NOT_FOUND", "이 팀에서 선택한 세미나 자료를 찾을 수 없어요.");
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.flatMap(id => { const row = byId.get(id); return row ? [row] : []; });
}

export function presentationOption(row: { id: string; title: string; date: Date }): ResearchPresentationOption {
  return { id: row.id, title: row.title, date: row.date.toISOString() };
}
