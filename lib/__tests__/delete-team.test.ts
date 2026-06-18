import { beforeEach, describe, expect, it, vi } from "vitest";

// deleteTeam 단위 테스트 — prisma 델리게이트 호출을 기록해 "어떤 테이블을 어떤 순서로" 지우는지 검증.
// 실제 자식 cascade는 DB FK(onDelete: Cascade) 책임 — 여기선 FK 없는 팀-스코프 테이블 삭제 순서·트랜잭션만 본다.
const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@/lib/prisma", () => {
  const rec = (model: string) => ({
    deleteMany: vi.fn(async ({ where }: { where: { teamId: string } }) => {
      calls.push(`${model}.deleteMany:${where.teamId}`);
      return { count: 0 };
    }),
  });
  const team = {
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      calls.push(`team.delete:${where.id}`);
      return {};
    }),
  };
  const models = {
    memberLedger: rec("memberLedger"),
    fineConfig: rec("fineConfig"),
    paper: rec("paper"),
    presentation: rec("presentation"),
    scheduleMonth: rec("scheduleMonth"),
    liveSession: rec("liveSession"),
    teamInviteAcceptance: rec("teamInviteAcceptance"),
    team,
  };
  return {
    prisma: {
      ...models,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(models)),
    },
  };
});

import { deleteTeam } from "@/lib/teams";

beforeEach(() => {
  vi.clearAllMocks(); // 테스트 간 mock 호출 횟수 초기화($transaction 누적 방지)
  calls.length = 0;
});

describe("deleteTeam()", () => {
  it("팀-스코프 테이블을 정해진 순서로 지우고 마지막에 팀을 지운다", async () => {
    await deleteTeam("t1");
    expect(calls).toEqual([
      "memberLedger.deleteMany:t1",
      "fineConfig.deleteMany:t1",
      "paper.deleteMany:t1",
      "presentation.deleteMany:t1",
      "scheduleMonth.deleteMany:t1",
      "liveSession.deleteMany:t1",
      "teamInviteAcceptance.deleteMany:t1",
      "team.delete:t1",
    ]);
  });

  it("memberLedger를 fineConfig보다 먼저 지운다(FK restrict 회피)", async () => {
    await deleteTeam("t1");
    expect(calls.indexOf("memberLedger.deleteMany:t1")).toBeLessThan(
      calls.indexOf("fineConfig.deleteMany:t1"),
    );
  });

  it("모든 삭제를 단일 $transaction 안에서 수행한다", async () => {
    const { prisma } = await import("@/lib/prisma");
    await deleteTeam("t1");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
