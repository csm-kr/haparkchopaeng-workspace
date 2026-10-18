import { z } from "zod";
import { SeminarDraftSchema } from "./contract";

export const ExportRequestSchema = z.object({ requestId: z.uuid(), expectedVersion: z.number().int().min(0), seminar: SeminarDraftSchema }).strict();
const FileSchema = z.object({ path: z.string().min(1), bytes: z.number().int().positive() }).strict();
export const ExportPayloadSchema = z.object({
  version: z.literal(1), taskId: z.string(), teamId: z.string(), memberId: z.string(), paperId: z.string(), sourceRevision: z.string(),
  draftHash: z.string(), draft: SeminarDraftSchema, expectedVersion: z.number().int().min(0),
  files: z.object({ pdf: FileSchema, html: FileSchema }).strict().optional(),
  qa: z.object({ slideCount: z.number().int(), aspectRatio: z.literal("16:9"), embeddedFonts: z.array(z.string()), issues: z.array(z.string()) }).strict().optional(),
}).strict();
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type ExportPayload = z.infer<typeof ExportPayloadSchema>;
export interface SeminarExportView {
  id: string; status: "queued" | "running" | "done" | "failed"; current: boolean; error: string | null;
  files: { format: "pdf" | "html"; href: string }[]; qa: ExportPayload["qa"] | null;
}
