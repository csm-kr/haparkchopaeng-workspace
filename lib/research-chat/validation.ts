import { z } from "zod";

export const ConversationCreateSchema = z.object({
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  paperIds: z.array(z.string().min(1).max(150)).min(1).max(3).refine(ids => new Set(ids).size === ids.length),
}).strict();
export const TurnCreateSchema = z.object({
  requestId: z.uuid(), deviceId: z.string().min(1).max(150), provider: z.enum(["codex", "claude"]),
  model: z.string().min(1).max(160), prompt: z.string().trim().min(1).max(12_000),
}).strict();
