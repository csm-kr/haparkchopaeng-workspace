import { prisma } from "@/lib/prisma";

// 전역 앱 설정 (서버 전용, ADR-022). 관리자 콘솔(/admin)이 조절한다.
// CRITICAL: 우선순위는 DB(AppSetting) > env > 코드 기본. ADR-021 개정 —
//   상한은 더 이상 "env로만" 설정하지 않는다. env는 DB row가 없을 때의 폴백으로 남는다.
// CRITICAL: env는 호출 시점에 읽는다(R2). 범위 검증은 호출부(Server Action)의 책임이다.

const SINGLETON_ID = "singleton";
const DEFAULT_MAX_TEAMS = 2;

/** 상한으로 허용하는 범위. UI·Server Action이 함께 참조한다. */
export const MAX_TEAMS_MIN = 1;
export const MAX_TEAMS_MAX = 100;

/** env MAX_TEAMS. 미설정이거나 양의 정수가 아니면 기본 2. */
function envMaxTeams(): number {
  const raw = process.env.MAX_TEAMS;
  if (raw === undefined || raw === "") return DEFAULT_MAX_TEAMS;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_TEAMS;
}

/** 전역 팀 상한. DB > env > 2. */
export async function maxTeams(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { id: SINGLETON_ID } });
  if (row?.maxTeams != null && row.maxTeams > 0) return row.maxTeams;
  return envMaxTeams();
}

/** 전역 팀 상한 저장(멱등 upsert). updatedBy는 세션 memberId(R3). */
export async function setMaxTeams(value: number, updatedBy: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, maxTeams: value, updatedBy },
    update: { maxTeams: value, updatedBy },
  });
}
