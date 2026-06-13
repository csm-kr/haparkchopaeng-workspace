import { analyzePaper } from "@/lib/analysis";
import { inngest, type PaperAnalyzeData } from "@/lib/inngest";

// 논문 분석 Inngest 함수 — 요청 경로가 아니라 잡에서 실행한다(R31/ADR-013→016).
// retries로 일시 실패를 재시도하고, 본체(analyzePaper)는 실패 시 analysisStatus=failed로 격리한다(R28).

export const analyzePaperFn = inngest.createFunction(
  { id: "analyze-paper", retries: 3, triggers: [{ event: "paper/analyze" }] },
  async ({ event, step }) => {
    const { paperId } = event.data as PaperAnalyzeData;
    await step.run("analyze", () => analyzePaper(paperId));
    return { paperId, analysisStatus: "ready" };
  },
);
