import { beforeEach, describe, expect, it, vi } from "vitest";

// 라이브 route handler 단위 테스트 — auth/active-team/prisma/livekit/live/realtime을 모킹한다(AC).
// 검증(LiveKit · ADR-019 → 팀 스코핑 ADR-020):
//   GET 활성 팀 세션만(팀 없으면 null)
//   /start 미설정 503·팀당 1개 409·teamId 활성 팀 주입(R3)·presenterId 세션 주입(R3)·token+url
//   /join 미설정 503·비active 404·교차 팀 404·token+url(canPublishScreen:false, R7)
//   /leave 본인만·세션 active 유지(R6)·교차 팀 404
//   /end 발표자/관리자만(타인 403)·교차 팀 404·active=false·deleteRoom·broadcastLive("live.ended", R33)

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAuth: requireAuthMock,
  requireRole: vi.fn(),
}));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    liveSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    participant: { upsert: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { getActiveSessionMock } = vi.hoisted(() => ({
  getActiveSessionMock: vi.fn(),
}));
vi.mock("@/lib/live", () => ({ getActiveSession: getActiveSessionMock }));

const { issueAccessTokenMock, deleteRoomMock, isLiveConfiguredMock, livekitUrlMock } =
  vi.hoisted(() => ({
    issueAccessTokenMock: vi.fn(),
    deleteRoomMock: vi.fn(),
    isLiveConfiguredMock: vi.fn(),
    livekitUrlMock: vi.fn(),
  }));
vi.mock("@/lib/livekit", () => ({
  issueAccessToken: issueAccessTokenMock,
  deleteRoom: deleteRoomMock,
  isLiveConfigured: isLiveConfiguredMock,
  livekitUrl: livekitUrlMock,
  roomName: (id: string) => `live-${id}`,
}));

const { broadcastLiveMock } = vi.hoisted(() => ({ broadcastLiveMock: vi.fn() }));
vi.mock("@/lib/realtime", () => ({
  broadcastLive: broadcastLiveMock,
  LIVE_CHANNEL: "live",
}));

// 모킹 후 import — 라우트가 모킹된 의존성을 받도록.
const { GET: liveGET } = await import("@/app/api/live/route");
const { POST: startPOST } = await import("@/app/api/live/start/route");
const { POST: joinPOST } = await import("@/app/api/live/[id]/join/route");
const { POST: leavePOST } = await import("@/app/api/live/[id]/leave/route");
const { POST: endPOST } = await import("@/app/api/live/[id]/end/route");

const req = () => new Request("http://localhost/api/live", { method: "POST" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  isLiveConfiguredMock.mockReturnValue(true); // 기본: LiveKit 설정됨
  livekitUrlMock.mockReturnValue("wss://test.livekit.cloud");
  issueAccessTokenMock.mockResolvedValue("JWT_TOKEN");
  broadcastLiveMock.mockResolvedValue(undefined);
  deleteRoomMock.mockResolvedValue(undefined);
  // 기본: 활성 팀 tA의 멤버.
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
});

describe("GET /api/live", () => {
  it("활성 팀이 없으면 null(라이브 없음) — 조회하지 않는다", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    getActiveTeamMock.mockResolvedValue(null);

    const res = await liveGET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBeNull();
    expect(getActiveSessionMock).not.toHaveBeenCalled();
  });

  it("활성 팀의 세션만 돌려준다(getActiveSession(teamId))", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    getActiveSessionMock.mockResolvedValue({
      id: "s1",
      presenterId: "ha",
      startedAt: new Date("2026-06-13T01:00:00Z"),
      participants: [],
    });

    const res = await liveGET();
    expect(res.status).toBe(200);
    expect(getActiveSessionMock).toHaveBeenCalledWith("tA");
    expect((await res.json()).data.id).toBe("s1");
  });
});

describe("POST /api/live/start", () => {
  it("LiveKit 미설정이면 503 — 친절 안내(R30)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    isLiveConfiguredMock.mockReturnValue(false);

    const res = await startPOST();
    expect(res.status).toBe(503);
    expect(getActiveSessionMock).not.toHaveBeenCalled();
    expect(issueAccessTokenMock).not.toHaveBeenCalled();
    expect(prismaMock.liveSession.create).not.toHaveBeenCalled();
  });

  it("활성 팀이 없으면 403 (생성 안 함)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    getActiveTeamMock.mockResolvedValue(null);

    const res = await startPOST();
    expect(res.status).toBe(403);
    expect(prismaMock.liveSession.create).not.toHaveBeenCalled();
  });

  it("이미 같은 팀에 active 세션이 있으면 409 (팀당 1개)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    getActiveSessionMock.mockResolvedValue({
      id: "s1",
      presenterId: "ha",
      startedAt: new Date(),
      participants: [],
    });

    const res = await startPOST();
    expect(res.status).toBe(409);
    expect(getActiveSessionMock).toHaveBeenCalledWith("tA");
    expect(prismaMock.liveSession.create).not.toHaveBeenCalled();
  });

  it("없으면 생성하고 teamId·presenterId를 세션/활성 팀에서 주입(R3) + 발표자 token+url 반환", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    getActiveSessionMock.mockResolvedValue(null);
    prismaMock.liveSession.create.mockResolvedValue({
      id: "s2",
      presenterId: "jo",
      startedAt: new Date("2026-06-13T01:00:00Z"),
    });

    const res = await startPOST();
    expect(res.status).toBe(201);

    // teamId는 활성 팀에서, presenterId는 세션에서 — 클라 입력 아님(R3).
    expect(prismaMock.liveSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          active: true,
          presenterId: "jo",
          teamId: "tA",
        }),
      }),
    );
    const createArg = prismaMock.liveSession.create.mock.calls[0][0];
    expect(createArg.data.cloudflareLiveInputId).toBeUndefined();

    expect(issueAccessTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s2",
        identity: "jo",
        canPublishScreen: true,
      }),
    );

    const body = await res.json();
    expect(body.data.token).toBe("JWT_TOKEN");
    expect(body.data.url).toBe("wss://test.livekit.cloud");
    expect(body.data.session.presenterId).toBe("jo");
    expect(body.data.session.id).toBe("s2");

    expect(broadcastLiveMock).toHaveBeenCalledWith(
      "live.started",
      expect.objectContaining({ sessionId: "s2" }),
    );
  });

  it("다른 팀(B)은 A의 세션과 무관하게 시작할 수 있다 — teamId=B로 생성", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    getActiveTeamMock.mockResolvedValue({ id: "tB", slug: "beta", role: "owner" });
    // 팀 B로 스코핑하면 active 세션이 없다(A의 세션은 B에 보이지 않음).
    getActiveSessionMock.mockResolvedValue(null);
    prismaMock.liveSession.create.mockResolvedValue({
      id: "s3",
      presenterId: "paeng",
      startedAt: new Date(),
    });

    const res = await startPOST();
    expect(res.status).toBe(201);
    expect(getActiveSessionMock).toHaveBeenCalledWith("tB");
    expect(prismaMock.liveSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamId: "tB", presenterId: "paeng" }),
      }),
    );
  });
});

describe("POST /api/live/:id/join", () => {
  it("LiveKit 미설정이면 503", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    isLiveConfiguredMock.mockReturnValue(false);

    const res = await joinPOST(req(), ctx("s1"));
    expect(res.status).toBe(503);
    expect(issueAccessTokenMock).not.toHaveBeenCalled();
  });

  it("비active 세션이면 404", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      active: false,
      teamId: "tA",
    });

    const res = await joinPOST(req(), ctx("s1"));
    expect(res.status).toBe(404);
    expect(issueAccessTokenMock).not.toHaveBeenCalled();
  });

  it("다른 팀의 세션이면 404 (교차 팀 차단, R19) — 토큰 발급 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      active: true,
      teamId: "tB", // 활성 팀은 tA
    });

    const res = await joinPOST(req(), ctx("s1"));
    expect(res.status).toBe(404);
    expect(issueAccessTokenMock).not.toHaveBeenCalled();
    expect(prismaMock.participant.upsert).not.toHaveBeenCalled();
  });

  it("성공 시 참가자 token+url — 화면공유 grant 없음(R7) + identity 세션 주입", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      active: true,
      teamId: "tA",
    });
    prismaMock.participant.upsert.mockResolvedValue({});

    const res = await joinPOST(req(), ctx("s1"));
    expect(res.status).toBe(200);

    expect(issueAccessTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        identity: "paeng",
        canPublishScreen: false,
      }),
    );

    const body = await res.json();
    expect(body.data.token).toBe("JWT_TOKEN");
    expect(body.data.url).toBe("wss://test.livekit.cloud");

    expect(prismaMock.participant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          liveSessionId_memberId: { liveSessionId: "s1", memberId: "paeng" },
        },
        update: { leftAt: null },
      }),
    );
  });
});

describe("POST /api/live/:id/leave", () => {
  it("본인 Participant만 닫고 세션은 active 유지(전역 종료 아님)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      teamId: "tA",
    });
    prismaMock.participant.updateMany.mockResolvedValue({ count: 1 });

    const res = await leavePOST(req(), ctx("s1"));
    expect(res.status).toBe(200);

    expect(prismaMock.participant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          liveSessionId: "s1",
          memberId: "paeng",
          leftAt: null,
        }),
      }),
    );
    // /leave는 세션을 종료하지 않는다(R6).
    expect(prismaMock.liveSession.update).not.toHaveBeenCalled();
  });

  it("다른 팀의 세션이면 404 (교차 팀 차단) — 퇴장 처리 안 함", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      teamId: "tB", // 활성 팀은 tA
    });

    const res = await leavePOST(req(), ctx("s1"));
    expect(res.status).toBe(404);
    expect(prismaMock.participant.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/live/:id/end", () => {
  it("발표자가 종료하면 active=false + deleteRoom + broadcastLive(leave≠end)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      presenterId: "jo",
      teamId: "tA",
    });
    prismaMock.liveSession.update.mockResolvedValue({});

    const res = await endPOST(req(), ctx("s1"));
    expect(res.status).toBe(200);
    expect(deleteRoomMock).toHaveBeenCalledWith("s1");
    expect(prismaMock.liveSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: expect.objectContaining({ active: false }),
      }),
    );
    expect(broadcastLiveMock).toHaveBeenCalledWith(
      "live.ended",
      expect.objectContaining({ sessionId: "s1" }),
    );
  });

  it("관리자도 종료할 수 있다", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      presenterId: "jo",
      teamId: "tA",
    });
    prismaMock.liveSession.update.mockResolvedValue({});

    const res = await endPOST(req(), ctx("s1"));
    expect(res.status).toBe(200);
  });

  it("다른 팀의 세션이면 404 (교차 팀 차단) — 권한 체크 전에 막는다", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      presenterId: "ha",
      teamId: "tB", // 활성 팀은 tA
    });

    const res = await endPOST(req(), ctx("s1"));
    expect(res.status).toBe(404);
    expect(deleteRoomMock).not.toHaveBeenCalled();
    expect(prismaMock.liveSession.update).not.toHaveBeenCalled();
  });

  it("발표자도 관리자도 아니면 403", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      presenterId: "jo",
      teamId: "tA",
    });

    const res = await endPOST(req(), ctx("s1"));
    expect(res.status).toBe(403);
    expect(deleteRoomMock).not.toHaveBeenCalled();
    expect(prismaMock.liveSession.update).not.toHaveBeenCalled();
  });
});
