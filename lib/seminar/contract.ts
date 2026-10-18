import { z } from "zod";
import { EffortSchema } from "@/lib/local-agent/validation";

const Id = z.string().min(1).max(150);
const Text = (max: number) => z.string().trim().min(1).max(max);
export const CitationSchema = z.object({ page: z.number().int().min(1).max(30), quote: Text(500).min(8) }).strict();
export const CitationsSchema = z.array(CitationSchema).min(1).max(12);
const NodeSchema = z.object({ id: Text(40).regex(/^[a-zA-Z0-9_-]+$/), label: Text(64) }).strict();
const EdgeSchema = z.object({ from: Text(40), to: Text(40), label: Text(32).optional() }).strict();
export const VisualSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("diagram"), caption: Text(300), nodes: z.array(NodeSchema).min(2).max(6), edges: z.array(EdgeSchema).min(1).max(10) }).strict(),
  z.object({ kind: z.literal("figure"), figureId: Id, caption: Text(300) }).strict(),
  z.object({ kind: z.literal("page"), page: z.number().int().min(1).max(30), caption: Text(300) }).strict(),
  z.object({ kind: z.literal("table"), caption: Text(300), columns: z.array(Text(60)).min(2).max(5), rows: z.array(z.array(Text(120)).min(2).max(5)).min(1).max(6) }).strict(),
]);
export const SeminarSlideSchema = z.object({ title: Text(160), subtitle: z.string().max(300).optional(), body: Text(3000), speakerNotes: Text(4000).optional(), visual: VisualSchema.optional(), citations: CitationsSchema.optional() }).strict();
export const SeminarDraftSchema = z.object({ title: Text(180), durationMinutes: z.number().int().min(5).max(120), summary: Text(6000), keypoints: z.array(Text(500)).min(1).max(10), slides: z.array(SeminarSlideSchema).min(3).max(16), citations: CitationsSchema }).strict();
export const BriefSchema = z.object({ purpose: z.string().max(600), audience: z.string().max(400), message: z.string().max(600), discussionGoal: z.string().max(500), durationMinutes: z.number().int().min(5).max(120), depth: z.string().max(400), style: z.literal("figures"), assumptions: z.array(Text(300)).max(8) }).strict();
export const DirectionSchema = z.object({ id: Text(40).regex(/^[a-zA-Z0-9_-]+$/), title: Text(100), message: Text(500), focus: Text(500), tradeoff: Text(500), citations: CitationsSchema }).strict();
export const QuestionSchema = z.object({ id: Text(50), text: Text(500).refine(value => (value.match(/[?？]/g) ?? []).length <= 1), options: z.array(z.object({ id: Text(40), label: Text(200) }).strict()).min(2).max(3), recommendedId: Text(40), reason: Text(500) }).strict().refine(question => new Set(question.options.map(option => option.id)).size === question.options.length && question.options.some(option => option.id === question.recommendedId));
export const OutlineSlideSchema = z.object({ id: Text(40), title: Text(160), claim: Text(600), visualPlan: Text(600), sourcePages: z.array(z.number().int().min(1).max(30)).min(1).max(6), figureId: Id.optional() }).strict();
const MessageSchema = z.object({ id: Text(150), role: z.enum(["user", "assistant"]), text: Text(4000), at: z.string() }).strict();
const Stages = z.enum(["directions", "interview", "outline", "deck"]);
export const SeminarWorkspaceSchema = z.object({ version: z.literal(1), type: z.literal("paper_pt"), stage: Stages, pending: Stages.nullable(), directions: z.array(DirectionSchema).max(3), selectedDirectionId: z.string().nullable(), brief: BriefSchema, question: QuestionSchema.nullable(), outline: z.array(OutlineSlideSchema).max(16), deck: SeminarDraftSchema.nullable(), messages: z.array(MessageSchema).max(84), turnCount: z.number().int().min(0).max(40) }).strict();
const Assistant = Text(1600).refine(text => !/[?？]/.test(text), "Put the single question in question.text");
export const GuidedDecisionSchemas = [
  z.object({ version: z.literal(1), action: z.literal("seminar_directions"), message: Assistant, directions: z.array(DirectionSchema).min(2).max(3) }).strict(),
  z.object({ version: z.literal(1), action: z.literal("seminar_question"), message: Assistant, brief: BriefSchema.partial(), question: QuestionSchema }).strict(),
  z.object({ version: z.literal(1), action: z.literal("seminar_outline"), message: Assistant, brief: BriefSchema.partial(), outline: z.array(OutlineSlideSchema).min(3).max(16) }).strict(),
  z.object({ version: z.literal(1), action: z.literal("seminar_draft"), message: Assistant.optional(), draft: SeminarDraftSchema }).strict(),
] as const;
export const GuidedDecisionSchema = z.discriminatedUnion("action", GuidedDecisionSchemas);
export const SeminarInputSchema = z.object({ action: z.enum(["choose", "answer", "outline", "build", "revise"]), text: Text(4000).optional(), directionId: Text(40).optional() }).strict().refine(value => value.action !== "choose" || Boolean(value.directionId)).refine(value => !["answer", "revise"].includes(value.action) || Boolean(value.text));
export const SeminarActionSchema = SeminarInputSchema.safeExtend({ requestId: z.uuid(), expectedVersion: z.number().int().min(0), deviceId: Id.optional(), provider: z.enum(["codex", "claude"]).optional(), model: Text(160).optional(), effort: EffortSchema.optional(), reviewedDraft: SeminarDraftSchema.optional() });

export type SeminarDraft = z.infer<typeof SeminarDraftSchema>;
export type SeminarSlide = z.infer<typeof SeminarSlideSchema>;
export type SeminarWorkspace = z.infer<typeof SeminarWorkspaceSchema>;
export type SeminarInput = z.infer<typeof SeminarInputSchema>;
export type SeminarAction = z.infer<typeof SeminarActionSchema>;
export interface SeminarFigure { id: string; title: string; caption: string; sourcePage: number; available: boolean }
export interface SourcePage { page: number; text: string }
