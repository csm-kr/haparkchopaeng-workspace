import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { analyzePaperFn } from "@/worker/analyze-paper";
import { prepareResearchChatFn } from "@/worker/research-chat";

// Inngest 잡 엔드포인트. 로컬 Dev Server가 논문 본문·분석 준비와 채팅 자료 준비 함수를
// 발견한다. 프로덕션에서는 INNGEST_* 키로 서명하고 새 함수 등록을 동기화한다.

// PDF 추출은 durable step에서 처리하고, 긴 로컬 CLI 추론은 데스크톱에서 실행한다.
// 각 본문 준비·결과 저장 요청에 Vercel 실행 시간 상한을 적용한다(ADR-016/026).
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [analyzePaperFn, prepareResearchChatFn],
});
