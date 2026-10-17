import { beforeEach, describe, expect, it, vi } from "vitest";

// getActiveSession(teamId) 팀 스코핑(ADR-020/R37) — 라이브는 팀당 1개다.
// CRITICAL: where에 teamId가 들어가야 다른 팀의 active 세션이 섞이지 않는다.

const { findFirstMock, createMock, transactionMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(), createMock: vi.fn(), transactionMock: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { liveSession: { findFirst: findFirstMock }, $transaction: transactionMock },
}));

import { createLiveSession, getActiveSession } from "@/lib/live";

beforeEach(() => {
  vi.clearAllMocks();
  findFirstMock.mockResolvedValue(null);
  transactionMock.mockReset().mockImplementation((work) => work({
    liveSession: { findFirst: findFirstMock, create: createMock },
  }));
  createMock.mockResolvedValue({ id: "s1", teamId: "tA", presenterId: "jo" });
});

describe("createLiveSession", () => {
  it("서버가 검증한 팀과 발표자로 생성한다", async () => {
    expect(await createLiveSession("tA", "jo")).toMatchObject({ id: "s1", teamId: "tA" });
    expect(createMock).toHaveBeenCalledWith({ data: { teamId: "tA", presenterId: "jo", active: true } });
  });

  it("같은 팀에 활성 세션이 있으면 생성하지 않고 409로 거절한다", async () => {
    findFirstMock.mockResolvedValue({ id: "existing" });
    await expect(createLiveSession("tA", "jo")).rejects.toMatchObject({ status: 409 });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("DB 직렬화 충돌 후 다시 조회해 이미 생성된 세션과 충돌로 안내한다", async () => {
    transactionMock.mockRejectedValueOnce({ code: "P2034" });
    findFirstMock.mockResolvedValue({ id: "winner" });
    await expect(createLiveSession("tA", "jo")).rejects.toMatchObject({ status: 409 });
    expect(createMock).not.toHaveBeenCalled();
    expect(transactionMock).toHaveBeenCalledTimes(2);
  });

  it("DB 충돌 재시도는 무한 반복하지 않는다", async () => {
    transactionMock.mockRejectedValue({ code: "P2034" });
    await expect(createLiveSession("tA", "jo")).rejects.toMatchObject({ status: 409 });
    expect(transactionMock).toHaveBeenCalledTimes(3);
  });

  it("직렬화 충돌이 아닌 DB 오류는 그대로 전달한다", async () => {
    const error = new Error("database unavailable");
    transactionMock.mockRejectedValue(error);
    await expect(createLiveSession("tA", "jo")).rejects.toBe(error);
    expect(transactionMock).toHaveBeenCalledOnce();
  });
});

describe("getActiveSession(teamId)", () => {
  it("active + teamId로 스코핑해 조회한다(팀당 1개)", async () => {
    await getActiveSession("tA");
    const arg = findFirstMock.mock.calls[0][0];
    expect(arg.where).toMatchObject({ active: true, teamId: "tA" });
  });

  it("없으면 null", async () => {
    expect(await getActiveSession("tA")).toBeNull();
  });
});
