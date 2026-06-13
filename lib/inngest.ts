import { Inngest } from "inngest";

// 외부 durable 잡 러너(Inngest) 클라이언트 — 분석 등 분 단위 작업은 요청 경로가 아니라
// 잡으로 실행한다(ADR-013→016/R31). 로컬은 Inngest Dev Server(키 불필요),
// 프로덕션은 INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY로 동작한다.

/** paper/analyze 이벤트 페이로드 — 분석할 논문 id만 싣는다. */
export interface PaperAnalyzeData {
  paperId: string;
}

export const inngest = new Inngest({ id: "hapark" });
