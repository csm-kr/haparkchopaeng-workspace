import { failAnalysisRun, finishAnalysisRun, prepareAnalysisRun, preparePaperSource, readAnalysisJob } from "@/lib/local-ai/service";
import { sourceFailureMessage } from "@/lib/local-ai/source";
import { prisma } from "@/lib/prisma";
import { broadcastPaperAnalyzed } from "@/lib/realtime";
import { inngest, type PaperAnalyzeData } from "@/lib/inngest";

// Upload prepares text only. Explicit local model requests execute through the durable DB queue.
// Inngest sleeps between short reads; no HTTP request or in-memory promise waits on CLI inference.

export const analyzePaperFn = inngest.createFunction(
  { id: "analyze-paper", retries: 3, triggers: [{ event: "paper/analyze" }] },
  async ({ event, step }) => {
    const { paperId, runId } = event.data as PaperAnalyzeData;
    if (!runId) {
      try { await step.run("prepare-source", () => preparePaperSource(paperId)); }
      catch (cause) {
        const analysisError = sourceFailureMessage(cause);
        await step.run("source-failed", async () => {
          await prisma.paper.updateMany({
            where: { id: paperId, sourceText: null, analysisRequestId: null, analysisStatus: "pending" },
            data: { analysisStatus: "failed", analysisError },
          });
          // Preserve a previous result and never overwrite a newer source or an active explicit run.
          await prisma.paper.updateMany({
            where: { id: paperId, sourceText: null, analysisStatus: { not: "pending" } },
            data: { analysisError },
          });
        });
        return { paperId, analysisStatus: "failed" };
      }
      return { paperId, analysisStatus: "awaiting_ai" };
    }
    try {
      await step.run("prepare-local-analysis", () => prepareAnalysisRun(runId));
      for (let index = 0; index < 121; index++) {
        const job = await step.run(`read-local-${index}`, () => readAnalysisJob(runId));
        if (job && !["queued", "running"].includes(job.status)) break;
        if (index === 120) {
          await step.run("local-timeout", () => failAnalysisRun(runId, "분석 대기 시간이 끝났어요. 연결을 확인하고 다시 분석해주세요."));
          return { paperId, analysisStatus: "failed" };
        }
        await step.sleep(`wait-local-${index}`, "5s");
      }
      const status = await step.run("persist-local-analysis", () => finishAnalysisRun(runId));
      if (status !== "ready") return { paperId, analysisStatus: status };
    } catch {
      await step.run("local-failed", () => failAnalysisRun(runId));
      return { paperId, analysisStatus: "failed" };
    }
    // 완료 전파 — 실패해도 분석 결과를 막지 않는다(broadcast 자체가 graceful).
    await step.run("notify", async () => {
      const paper = await prisma.paper.findUnique({
        where: { id: paperId },
        select: { teamId: true, title: true },
      });
      if (paper)
        await broadcastPaperAnalyzed({
          paperId,
          teamId: paper.teamId,
          title: paper.title,
        });
    });
    return { paperId, analysisStatus: "ready" };
  },
);
