import type { Prisma } from "@prisma/client";
import { HttpError } from "./http";

interface PresentationContent {
  title: string; duration?: string | null; sourcePaperId?: string; slideCount: number;
  summary?: string | null; keypoints?: string[]; slides?: { title: string; body: string; subtitle?: string }[];
  asset?: { filename: string; type: "pdf" | "ppt"; size: string; objectPath: string };
}
/** Authenticated callers supply scope. All presentation creation shares this state boundary. */
export async function createPresentationRecord(db: Prisma.TransactionClient, scope: { teamId: string; memberId: string }, input: PresentationContent) {
  if (input.sourcePaperId && !await db.paper.findFirst({ where: { id: input.sourcePaperId, teamId: scope.teamId }, select: { id: true } })) throw new HttpError(404, "NOT_FOUND", "현재 팀의 원문 논문을 찾을 수 없어요.");
  return db.presentation.create({ data: { title: input.title, teamId: scope.teamId, presenterId: scope.memberId, date: new Date(), duration: input.duration ?? null,
    slideCount: input.slideCount, tags: [], summary: input.summary ?? null, keypoints: input.keypoints ?? [], slides: input.slides ?? [], ...(input.sourcePaperId ? { sourcePaperId: input.sourcePaperId } : {}),
    assets: input.asset ? { create: { name: input.asset.filename, type: input.asset.type, size: input.asset.size, url: input.asset.objectPath } } : undefined }, select: { id: true } });
}
