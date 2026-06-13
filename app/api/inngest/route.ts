import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { analyzePaperFn } from "@/worker/analyze-paper";

// Inngest 잡 엔드포인트. 로컬은 Inngest Dev Server(`npx inngest-cli dev`)가 이 경로를
// 자동 발견해 paper/analyze 잡을 실행한다(키 불필요). 프로덕션은 INNGEST_* 키로 서명.

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [analyzePaperFn],
});
