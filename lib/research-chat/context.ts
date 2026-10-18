import { HttpError } from "@/lib/http";
import { parsePaperSource } from "@/lib/local-ai/source";
import type { ResearchMaterialReference } from "@/types/research-chat";
import { EffortSchema } from "@/lib/local-agent/validation";
import type { LocalAgentEffort } from "@/types/local-agent";

interface PaperInput { id: string; title: string; sourceText: string | null }
interface TurnInput { conversationTurn: number | null; prompt: string; response: string; status: string }
export interface PresentationInput {
  id: string; title: string; summary: string | null; keypoints: unknown; slides: unknown;
  pages?: { page: number; text: string }[];
}
const MAX_CONTEXT = 200_000;
const SCALE = 1_000_000;

function prefix(value: string, fraction: number): string {
  let end = Math.floor(value.length * fraction / SCALE);
  if (end && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
  return value.slice(0, end);
}

/** Fits serialized content rather than assuming JSON escaping has no cost. */
function fit<T>(render: (fraction: number) => T, accepts: (value: T) => boolean): { value: T; cut: boolean } {
  const full = render(SCALE);
  if (accepts(full)) return { value: full, cut: false };
  let lower = 0, upper = SCALE - 1;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (accepts(render(middle))) lower = middle; else upper = middle - 1;
  }
  return { value: render(lower), cut: true };
}

export function buildChatContext(papers: PaperInput[], turns: TurnInput[], presentations: PresentationInput[] = [], execution?: { effort: LocalAgentEffort }): { context: string; truncated: boolean } {
  if (papers.length + presentations.length > 10) throw new HttpError(400, "BAD_REQUEST", "한 번에 자료 10개까지 첨부할 수 있어요.");
  const sources = papers.map(paper => {
    try {
      if (!paper.sourceText) throw new Error("unprepared");
      const pages = parsePaperSource(paper.sourceText);
      if (!pages.some(page => page.text.trim())) throw new Error("empty");
      return { id: paper.id, title: paper.title.slice(0, 500), pages };
    } catch { throw new HttpError(409, "SOURCE_NOT_READY", "선택한 논문의 본문을 준비하고 있어요."); }
  });
  const seminarSources = presentations.map(item => ({ id: item.id, title: item.title.slice(0, 500), summary: item.summary ?? "",
    keypoints: Array.isArray(item.keypoints) ? item.keypoints.filter((value): value is string => typeof value === "string").slice(0, 100) : [],
    slides: Array.isArray(item.slides) ? item.slides.slice(0, 300).flatMap(value => {
      if (!value || typeof value !== "object" || typeof value.title !== "string" || typeof value.body !== "string") return [];
      return [{ title: value.title, subtitle: typeof value.subtitle === "string" ? value.subtitle : "", body: value.body }];
    }) : [], pages: item.pages ?? [],
  }));
  const completed = turns.filter(turn => turn.status === "completed").sort((a, b) => (a.conversationTurn ?? 0) - (b.conversationTurn ?? 0));
  const recent = completed.slice(-8);
  const history = fit(fraction => recent.map(turn => ({ turn: turn.conversationTurn,
    question: prefix(turn.prompt, fraction), answer: prefix(turn.response, fraction) })), value => JSON.stringify(value).length <= 45_000);
  let truncated = completed.length > recent.length || history.cut || [...papers, ...presentations].some(item => item.title.length > 500) || presentations.some(item => (Array.isArray(item.slides) && item.slides.length > 300) || (Array.isArray(item.keypoints) && item.keypoints.length > 100));
  const body = (items: { papers: typeof sources; presentations: typeof seminarSources }, limited: boolean) => ({ version: 1, kind: "research_chat", truncated: limited, ...items, history: history.value, ...(execution ? { execution } : {}) });
  const source = fit(fraction => ({
    papers: sources.map(paper => ({ ...paper, pages: paper.pages.map(page => ({ ...page, text: prefix(page.text, fraction) })) })),
    presentations: seminarSources.map(item => ({ ...item, summary: prefix(item.summary, fraction), keypoints: item.keypoints.map(text => prefix(text, fraction)),
      slides: item.slides.map(slide => ({ title: prefix(slide.title, fraction), subtitle: prefix(slide.subtitle, fraction), body: prefix(slide.body, fraction) })),
      pages: item.pages.map(page => ({ ...page, text: prefix(page.text, fraction) })),
    })),
  }),
    value => JSON.stringify(body(value, true)).length <= MAX_CONTEXT);
  truncated ||= source.cut;
  const context = JSON.stringify(body(source.value, truncated));
  if (context.length > MAX_CONTEXT) throw new HttpError(400, "CONTEXT_TOO_LARGE", "선택한 자료의 분량이 너무 커요. 첨부 자료 수를 줄여주세요.");
  return { context, truncated };
}

export function materialsFromContext(context: string): ResearchMaterialReference[] {
  try {
    const value = JSON.parse(context);
    if (value?.kind !== "research_chat" || value.version !== 1) return [];
    return ([ ["paper", value.papers], ["presentation", value.presentations] ] as const).flatMap(([kind, items]) =>
      Array.isArray(items) ? items.flatMap(item => item && typeof item.id === "string" && typeof item.title === "string" ? [{ kind, id: item.id, title: item.title }] : []) : []);
  } catch { return []; }
}

export function effortFromContext(context: string) {
  try {
    const value = JSON.parse(context);
    if (value?.kind !== "research_chat" || value.version !== 1) return undefined;
    const parsed = EffortSchema.safeParse(value.execution?.effort);
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

export function contextWasTruncated(context: string): boolean {
  try { const value = JSON.parse(context); return value?.kind === "research_chat" && value.version === 1 && value.truncated === true; }
  catch { return false; }
}
