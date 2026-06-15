import { analyzePaper } from "@/lib/analysis";
import { prisma } from "@/lib/prisma";
import { broadcastPaperAnalyzed } from "@/lib/realtime";
import { inngest, type PaperAnalyzeData } from "@/lib/inngest";

// 논문 분석 Inngest 함수 — 요청 경로가 아니라 잡에서 실행한다(R31/ADR-013→016).
// retries로 일시 실패를 재시도하고, 본체(analyzePaper)는 실패 시 analysisStatus=failed로 격리한다(R28).
// 성공하면 팀 채널로 완료를 push해 열린 논문 상세가 자동 갱신되고 전역 알림이 뜬다(best-effort, R33).

export const analyzePaperFn = inngest.createFunction(
  { id: "analyze-paper", retries: 3, triggers: [{ event: "paper/analyze" }] },
  async ({ event, step }) => {
    const { paperId } = event.data as PaperAnalyzeData;
    await step.run("analyze", () => analyzePaper(paperId));
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
