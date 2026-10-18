import { HttpError } from "@/lib/http";
import { parsePaperSource } from "@/lib/local-ai/source";

interface PaperInput { id: string; title: string; sourceText: string | null }
interface TurnInput { conversationTurn: number | null; prompt: string; response: string; status: string }
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

export function buildChatContext(papers: PaperInput[], turns: TurnInput[]): { context: string; truncated: boolean } {
  if (!papers.length || papers.length > 3) throw new HttpError(400, "BAD_REQUEST", "대화에서 사용할 논문을 1~3개 선택해주세요.");
  const sources = papers.map(paper => {
    try {
      if (!paper.sourceText) throw new Error("unprepared");
      const pages = parsePaperSource(paper.sourceText);
      if (!pages.some(page => page.text.trim())) throw new Error("empty");
      return { id: paper.id, title: paper.title.slice(0, 500), pages };
    } catch { throw new HttpError(409, "SOURCE_NOT_READY", "선택한 논문의 본문이 아직 준비되지 않았어요. 논문에서 분석을 시작한 뒤 다시 시도해주세요."); }
  });
  const completed = turns.filter(turn => turn.status === "completed").sort((a, b) => (a.conversationTurn ?? 0) - (b.conversationTurn ?? 0));
  const recent = completed.slice(-8);
  const history = fit(fraction => recent.map(turn => ({ turn: turn.conversationTurn,
    question: prefix(turn.prompt, fraction), answer: prefix(turn.response, fraction) })), value => JSON.stringify(value).length <= 45_000);
  let truncated = completed.length > recent.length || history.cut || papers.some(paper => paper.title.length > 500);
  const body = (items: typeof sources, limited: boolean) => ({ version: 1, kind: "research_chat", truncated: limited, papers: items, history: history.value });
  const source = fit(fraction => sources.map(paper => ({ ...paper, pages: paper.pages.map(page => ({ ...page, text: prefix(page.text, fraction) })) })),
    value => JSON.stringify(body(value, true)).length <= MAX_CONTEXT);
  truncated ||= source.cut;
  const context = JSON.stringify(body(source.value, truncated));
  if (context.length > MAX_CONTEXT) throw new HttpError(400, "CONTEXT_TOO_LARGE", "선택한 논문 문맥이 너무 커요. 논문 수를 줄여주세요.");
  return { context, truncated };
}

export function contextWasTruncated(context: string): boolean {
  try { const value = JSON.parse(context); return value?.kind === "research_chat" && value.version === 1 && value.truncated === true; }
  catch { return false; }
}
