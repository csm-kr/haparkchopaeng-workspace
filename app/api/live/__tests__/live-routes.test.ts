import { beforeEach, describe, expect, it, vi } from "vitest";

// 라이브 route handler 단위 테스트 — auth/prisma/cloudflare/live를 모킹한다(AC).
// 검증: /start 409·presenterId 세션 주입·streamKey 노출 / /join streamKey 미노출 /
//       /leave 본인만·세션 active 유지 / /end active=false·발표자·관리자만(타인 403)

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAuth: requireAuthMock,
  requireRole: vi.fn(),
}));

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

const {
  createLiveInputMock,
  deleteLiveInputMock,
  getLiveInputPlaybackMock,
  isLiveConfiguredMock,
} = vi.hoisted(() => ({
  createLiveInputMock: vi.fn(),
  deleteLiveInputMock: vi.fn(),
  getLiveInputPlaybackMock: vi.fn(),
  isLiveConfiguredMock: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({
  createLiveInput: createLiveInputMock,
  deleteLiveInput: deleteLiveInputMock,
  getLiveInputPlayback: getLiveInputPlaybackMock,
  verifyWebhookSignature: vi.fn(),
  isLiveConfigured: isLiveConfiguredMock,
}));

// 모킹 후 import — 라우트가 모킹된 의존성을 받도록.
const { POST: startPOST } = await import("@/app/api/live/start/route");
const { POST: joinPOST } = await import("@/app/api/live/[id]/join/route");
const { POST: leavePOST } = await import("@/app/api/live/[id]/leave/route");
const { POST: endPOST } = await import("@/app/api/live/[id]/end/route");

const req = () => new Request("http://localhost/api/live", { method: "POST" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  isLiveConfiguredMock.mockReturnValue(true); // 기본: 송출 설정됨
});

describe("POST /api/live/start", () => {
  it("송출(Cloudflare) 미설정이면 503 — 친절 안내(R30)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    isLiveConfiguredMock.mockReturnValue(false);

    const res = await startPOST();
    expect(res.status).toBe(503);
    expect(getActiveSessionMock).not.toHaveBeenCalled();
    expect(createLiveInputMock).not.toHaveBeenCalled();
  });

  it("이미 active 세션이 있으면 409", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    getActiveSessionMock.mockResolvedValue({
      id: "s1",
      presenterId: "ha",
      startedAt: new Date(),
      participants: [],
    });

    const res = await startPOST();
    expect(res.status).toBe(409);
    expect(createLiveInputMock).not.toHaveBeenCalled();
    expect(prismaMock.liveSession.create).not.toHaveBeenCalled();
  });

  it("없으면 생성하고 presenterId를 세션에서 주입한다(R3) + streamKey 노출", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    getActiveSessionMock.mockResolvedValue(null);
    createLiveInputMock.mockResolvedValue({
      liveInputId: "li1",
      rtmps: { url: "rtmps://x", streamKey: "SECRET_KEY" },
      srt: { url: "srt://x", streamId: "sid", passphrase: "PASS" },
      playback: { hls: "https://hls" },
    });
    prismaMock.liveSession.create.mockResolvedValue({
      id: "s2",
      presenterId: "jo",
      startedAt: new Date("2026-06-13T01:00:00Z"),
    });

    const res = await startPOST();
    expect(res.status).toBe(201);

    // presenterId·cloudflareLiveInputId는 세션/Cloudflare에서 — 클라 입력 아님.
    expect(prismaMock.liveSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          active: true,
          presenterId: "jo",
          cloudflareLiveInputId: "li1",
        }),
      }),
    );

    // 발표자에게만 송출 자격증명을 돌려준다(SECURITY/R36).
    const body = await res.json();
    expect(body.data.rtmps.streamKey).toBe("SECRET_KEY");
    expect(body.data.srt.passphrase).toBe("PASS");
    expect(body.data.playback.hls).toBe("https://hls");
  });
});

describe("POST /api/live/:id/join", () => {
  it("재생용 HLS만 — 송출 자격증명 미포함(R36)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      active: true,
      cloudflareLiveInputId: "li1",
    });
    prismaMock.participant.upsert.mockResolvedValue({});
    getLiveInputPlaybackMock.mockResolvedValue({ hls: "https://hls" });

    const res = await joinPOST(req(), ctx("s1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.playback.hls).toBe("https://hls");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("streamKey");
    expect(serialized).not.toContain("passphrase");

    // memberId는 세션에서, 재참가 허용(leftAt=null).
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
});

describe("POST /api/live/:id/end", () => {
  it("발표자가 종료하면 active=false (leave≠end)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      presenterId: "jo",
      cloudflareLiveInputId: "li1",
    });
    prismaMock.liveSession.update.mockResolvedValue({});

    const res = await endPOST(req(), ctx("s1"));
    expect(res.status).toBe(200);
    expect(deleteLiveInputMock).toHaveBeenCalledWith("li1");
    expect(prismaMock.liveSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: expect.objectContaining({ active: false }),
      }),
    );
  });

  it("관리자도 종료할 수 있다", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      presenterId: "jo",
      cloudflareLiveInputId: "li1",
    });
    prismaMock.liveSession.update.mockResolvedValue({});

    const res = await endPOST(req(), ctx("s1"));
    expect(res.status).toBe(200);
  });

  it("발표자도 관리자도 아니면 403", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "paeng", role: "멤버" });
    prismaMock.liveSession.findUnique.mockResolvedValue({
      id: "s1",
      presenterId: "jo",
      cloudflareLiveInputId: "li1",
    });

    const res = await endPOST(req(), ctx("s1"));
    expect(res.status).toBe(403);
    expect(deleteLiveInputMock).not.toHaveBeenCalled();
    expect(prismaMock.liveSession.update).not.toHaveBeenCalled();
  });
});
