import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { analyzePaperFn } from "@/worker/analyze-paper";

// Inngest 잡 엔드포인트. 로컬은 Inngest Dev Server(`npx inngest-cli dev`)가 이 경로를
// 자동 발견해 paper/analyze 잡을 실행한다(키 불필요). 프로덕션은 INNGEST_* 키로 서명.

// 분석은 단일 step에서 Gemini 3호출 + figure 렌더로 분 단위가 될 수 있다 — Vercel 함수
// 타임아웃을 Hobby 상한(60초)까지 올린다. 그래도 넘치면 step 분할이 필요(ADR-013→016).
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [analyzePaperFn],
});
