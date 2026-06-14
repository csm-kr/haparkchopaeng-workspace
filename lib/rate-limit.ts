import { prisma } from "@/lib/prisma";

// 주간 업로드 한도 — Gemini 분석 비용 통제용(논문 1편 = Gemini 3호출).
// 멤버별 "최근 7일(롤링) 업로드한 Paper 수"로 판정한다. 별도 테이블 없이 Paper.uploadedAt만으로 집계.
// reanalyze는 새 Paper를 만들지 않으므로 한도에 들지 않는다(실패 재시도는 무료).
// CRITICAL: 한도값은 호출 시점에 env에서 읽는다(R2). 기본은 운영에서만 20편/주, 그 외(개발·자동테스트)는
//   무제한 — "테스트할 때 무제한" 요구. 어디서든 PAPER_WEEKLY_LIMIT로 조정/비활성(0 이하 = 무제한).
// TODO: 관리자(role="관리자") 예외는 추후. 지금은 전원 동일 적용.

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 롤링 7일

/** 인당 주간 업로드 한도. 0 이하면 무제한. */
export function paperWeeklyLimit(): number {
  const raw = process.env.PAPER_WEEKLY_LIMIT;
  if (raw !== undefined && raw !== "") return Number(raw);
  return process.env.NODE_ENV === "production" ? 20 : 0;
}

/** 최근 7일간 이 멤버가 올린 논문 수(롤링). */
async function usedThisWeek(memberId: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MS);
  return prisma.paper.count({
    where: { uploadedBy: memberId, uploadedAt: { gte: since } },
  });
}

/** 최근 7일 업로드 수가 한도 이상이면 true. 무제한(한도≤0)이면 DB 조회 없이 false. */
export async function isPaperQuotaExceeded(memberId: string): Promise<boolean> {
  const limit = paperWeeklyLimit();
  if (limit <= 0) return false;
  return (await usedThisWeek(memberId)) >= limit;
}

/** 주간 분석 한도 현황(표시용). */
export interface QuotaStatus {
  limit: number; // 0 이하 = 무제한
  used: number; // 최근 7일 업로드 수
  remaining: number | null; // 무제한이면 null
}

/** 인당 주간 분석 한도 현황. 무제한(한도≤0)이면 remaining=null, used는 항상 집계. */
export async function quotaStatus(memberId: string): Promise<QuotaStatus> {
  const limit = paperWeeklyLimit();
  const used = await usedThisWeek(memberId);
  const remaining = limit <= 0 ? null : Math.max(0, limit - used);
  return { limit, used, remaining };
}
