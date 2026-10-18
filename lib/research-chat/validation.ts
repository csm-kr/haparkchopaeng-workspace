import { z } from "zod";
import { EffortSchema } from "@/lib/local-agent/validation";

const References = z.array(z.string().min(1).max(150)).max(10).refine(ids => new Set(ids).size === ids.length);
export const MaterialSelectionSchema = z.object({
  paperIds: References.optional(), presentationIds: References.optional(),
}).strict().refine(value => (value.paperIds?.length ?? 0) + (value.presentationIds?.length ?? 0) <= 10);
export const ConversationCreateSchema = z.object({
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  paperIds: References.optional(), presentationIds: References.optional(),
}).strict().refine(value => (value.paperIds?.length ?? 0) + (value.presentationIds?.length ?? 0) <= 10);
export const TurnCreateSchema = z.object({
  requestId: z.uuid(), deviceId: z.string().min(1).max(150), provider: z.enum(["codex", "claude"]),
  model: z.string().min(1).max(160), prompt: z.string().trim().min(1).max(12_000),
  paperIds: References.optional(), presentationIds: References.optional(),
  effort: EffortSchema.optional(),
}).strict().refine(value => (value.paperIds?.length ?? 0) + (value.presentationIds?.length ?? 0) <= 10)
  .refine(value => value.provider !== "codex" || value.effort !== "max");
