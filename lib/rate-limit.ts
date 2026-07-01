import { prisma } from "@/lib/prisma";

// 주간 업로드 한도 — Gemini 분석 비용 통제용(논문 1편 = Gemini 3호출).
// 멤버별 "이번 주(월요일 00:00 KST 이후) 업로드한 Paper 수"로 판정한다. 별도 테이블 없이 Paper.uploadedAt만으로 집계.
// CRITICAL: 매주 월요일 0시(KST)에 카운트가 0으로 리셋된다 — UI의 "이번 주"/"다음 주" 문구와 일치.
//   (과거엔 롤링 7일 윈도우여서 지난주 업로드가 이번 주 카운트에 남아 주 경계에서 리셋되지 않았다.)
// reanalyze는 새 Paper를 만들지 않으므로 한도에 들지 않는다(실패 재시도는 무료).
// CRITICAL: 한도값은 호출 시점에 env에서 읽는다(R2). 기본은 운영에서만 20편/주, 그 외(개발·자동테스트)는
//   무제한 — "테스트할 때 무제한" 요구. 어디서든 PAPER_WEEKLY_LIMIT로 조정/비활성(0 이하 = 무제한).
// TODO: 관리자(role="관리자") 예외는 추후. 지금은 전원 동일 적용.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // KST = UTC+9

/**
 * 이번 주 시작(월요일 00:00 KST)의 UTC 순간. 서버는 UTC로 돌지만 "주"는 KST 벽시계 기준으로 끊는다.
 * 경계는 포함(월요일 00:00 KST 정각이면 그 순간을 그대로 돌려줌).
 */
export function startOfWeekKST(now: Date = new Date()): Date {
  // now을 KST 벽시계로 옮겨(내부 UTC 필드로 KST 연·월·일·요일을 읽는다).
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const daysSinceMonday = (kst.getUTCDay() + 6) % 7; // 월=0 … 일=6
  const mondayMidnightKst = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate() - daysSinceMonday, // 음수·월경계는 Date.UTC가 정규화
  );
  // KST 벽시계 값을 다시 실제 UTC 순간으로 환산.
  return new Date(mondayMidnightKst - KST_OFFSET_MS);
}

/** 인당 주간 업로드 한도. 0 이하면 무제한. */
export function paperWeeklyLimit(): number {
  const raw = process.env.PAPER_WEEKLY_LIMIT;
  if (raw !== undefined && raw !== "") return Number(raw);
  return process.env.NODE_ENV === "production" ? 20 : 0;
}

/** 이번 주(월요일 00:00 KST 이후) 이 멤버가 올린 논문 수. */
async function usedThisWeek(memberId: string): Promise<number> {
  return prisma.paper.count({
    where: { uploadedBy: memberId, uploadedAt: { gte: startOfWeekKST() } },
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
