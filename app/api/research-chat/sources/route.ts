import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";
import { HttpError } from "@/lib/http";
import { parseJson, response, webScope } from "@/lib/local-agent/request";
import { SOURCE_FAILURE_MESSAGES } from "@/lib/local-ai/source";

const Input = z.object({ paperIds: z.array(z.string().min(1).max(150)).min(1).max(3).refine((ids) => new Set(ids).size === ids.length) }).strict();
/** Existing papers can prepare their original text without re-running or selecting an AI. */
export async function POST(req: Request): Promise<Response> {
  return response(async () => {
    const scope = await webScope(req, true);
    const { paperIds } = await parseJson(req, Input);
    const papers = await prisma.paper.findMany({ where: { id: { in: paperIds }, teamId: scope.teamId }, select: { id: true, sourceText: true } });
    if (papers.length !== paperIds.length) throw new HttpError(404, "NOT_FOUND", "이 팀에서 선택한 논문을 찾을 수 없어요.");
    const preparing = papers.filter((paper) => !paper.sourceText).map((paper) => paper.id);
    if (preparing.length) {
      await prisma.paper.updateMany({
        where: { id: { in: preparing }, teamId: scope.teamId, sourceText: null, analysisError: { in: [...SOURCE_FAILURE_MESSAGES] } },
        data: { analysisError: null },
      });
      try { await inngest.send(preparing.map((paperId) => ({ name: "paper/analyze", data: { paperId } }))); }
      catch { throw new HttpError(503, "QUEUE_UNAVAILABLE", "본문 준비를 시작하지 못했어요. 잠시 후 다시 시도해주세요."); }
    }
    return { preparing, ready: papers.filter((paper) => Boolean(paper.sourceText)).map((paper) => paper.id) };
  }, 202);
}
