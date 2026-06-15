import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// 초대 토큰 도메인(ADR-018/R18)을 prisma 인메모리 목으로 검증한다.
// 검증: 랜덤 토큰 생성 · 링크 · 프리뷰 status 파생 · acceptInvite(멱등/만료/회수/used_up/race 직렬화).
// CRITICAL: 합류는 acceptInvite(트랜잭션 + SELECT … FOR UPDATE)만 Membership을 쓴다 — 직렬화로 race 방지.

interface InviteRow {
  id: string;
  teamId: string;
  token: string;
  role: string;
  maxUses: number;
  usedCount: number;
  expiresAt: Date;
  revokedAt: Date | null;
  usedAt: Date | null;
}
interface TeamRow {
  id: string;
  slug: string;
  name: string;
}
interface MembershipRow {
  teamId: string;
  memberId: string;
  role: string;
}
interface AcceptanceRow {
  inviteId: string;
  teamId: string;
  memberId: string;
  acceptedRole: string;
}

const { db } = vi.hoisted(() => ({
  db: {
    invites: [] as InviteRow[],
    teams: new Map<string, TeamRow>(),
    memberships: [] as MembershipRow[],
    acceptances: [] as AcceptanceRow[],
    seq: { invite: 0 },
  },
}));

vi.mock("@/lib/prisma", () => {
  const invite = {
    create: vi.fn(
      async ({
        data,
      }: {
        data: {
          teamId: string;
          token: string;
          role: string;
          maxUses: number;
          expiresAt: Date;
          createdBy: string;
        };
      }) => {
        const row: InviteRow = {
          id: `inv${++db.seq.invite}`,
          teamId: data.teamId,
          token: data.token,
          role: data.role,
          maxUses: data.maxUses,
          usedCount: 0,
          expiresAt: data.expiresAt,
          revokedAt: null,
          usedAt: null,
        };
        db.invites.push(row);
        return row;
      },
    ),
    findUnique: vi.fn(
      async ({
        where,
        include,
      }: {
        where: { token: string };
        include?: { team?: boolean };
      }) => {
        const row = db.invites.find((i) => i.token === where.token) ?? null;
        if (!row) return null;
        if (include?.team) return { ...row, team: db.teams.get(row.teamId) ?? null };
        return row;
      },
    ),
  };

  const tx = {
    // SELECT … FOR UPDATE 대체. 태그드 템플릿이라 (strings, token)로 들어온다.
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, token: string) => {
      const row = db.invites.find((i) => i.token === token);
      return row ? [{ ...row }] : [];
    }),
    team: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.teams.get(where.id) ?? null),
    },
    membership: {
      findUnique: vi.fn(
        async ({ where }: { where: { teamId_memberId: { teamId: string; memberId: string } } }) => {
          const { teamId, memberId } = where.teamId_memberId;
          return db.memberships.find((m) => m.teamId === teamId && m.memberId === memberId) ?? null;
        },
      ),
      create: vi.fn(
        async ({ data }: { data: { teamId: string; memberId: string; role: string } }) => {
          db.memberships.push({ ...data });
          return data;
        },
      ),
    },
    teamInviteAcceptance: {
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { inviteId_memberId: { inviteId: string; memberId: string } };
          create: AcceptanceRow;
          update: Record<string, never>;
        }) => {
          const { inviteId, memberId } = where.inviteId_memberId;
          const exists = db.acceptances.find(
            (a) => a.inviteId === inviteId && a.memberId === memberId,
          );
          if (!exists) db.acceptances.push({ ...create });
          return create;
        },
      ),
    },
    invite: {
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { usedCount: number; usedAt?: Date };
        }) => {
          const row = db.invites.find((i) => i.id === where.id);
          if (row) {
            row.usedCount = data.usedCount;
            if (data.usedAt !== undefined) row.usedAt = data.usedAt;
          }
          return row;
        },
      ),
    },
  };

  // 트랜잭션을 직렬화한다(같은 invite 행의 SELECT … FOR UPDATE가 직렬화되는 것을 모사).
  let lock: Promise<unknown> = Promise.resolve();
  const $transaction = vi.fn((fn: (t: typeof tx) => Promise<unknown>) => {
    const run = lock.then(() => fn(tx));
    lock = run.catch(() => {});
    return run;
  });

  return { prisma: { invite, $transaction } };
});

import { HttpError } from "@/lib/http";
import {
  acceptInvite,
  createInvite,
  generateInviteToken,
  getInviteForAcceptance,
  inviteLink,
} from "@/lib/invite";

const HOUR = 60 * 60 * 1000;

function seedTeam(id: string, slug: string, name: string) {
  db.teams.set(id, { id, slug, name });
}

function seedInvite(partial: Partial<InviteRow> & { token: string; teamId: string }) {
  const row: InviteRow = {
    id: `inv${++db.seq.invite}`,
    role: "member",
    maxUses: 1,
    usedCount: 0,
    expiresAt: new Date(Date.now() + 24 * HOUR),
    revokedAt: null,
    usedAt: null,
    ...partial,
  };
  db.invites.push(row);
  return row;
}

beforeAll(() => {
  process.env.APP_BASE_URL = "https://app.test";
});

beforeEach(() => {
  db.invites.length = 0;
  db.teams.clear();
  db.memberships.length = 0;
  db.acceptances.length = 0;
  db.seq.invite = 0;
  seedTeam("t1", "habakjopaeng", "하박조팽");
});

afterEach(() => {
  vi.clearAllMocks();
});

async function caught(p: Promise<unknown>): Promise<HttpError> {
  const e = await p.catch((err) => err);
  expect(e).toBeInstanceOf(HttpError);
  return e as HttpError;
}

describe("generateInviteToken()", () => {
  it("추측 불가한 충분한 엔트로피의 base64url 토큰", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });
});

describe("inviteLink()", () => {
  it("APP_BASE_URL + /invite/{token}", () => {
    expect(inviteLink("abc123")).toBe("https://app.test/invite/abc123");
  });
});

describe("createInvite()", () => {
  it("토큰·만료(+7일)·역할·기본 maxUses=1로 생성한다", async () => {
    const before = Date.now();
    const invite = await createInvite({ teamId: "t1", role: "member", createdBy: "jo" });
    expect(invite.token).toBeTruthy();
    expect(invite.role).toBe("member");
    expect(invite.maxUses).toBe(1);
    expect(invite.usedCount).toBe(0);
    const ttl = invite.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(6.9 * 24 * HOUR);
    expect(ttl).toBeLessThan(7.1 * 24 * HOUR);
  });

  it("maxUses를 지정할 수 있다", async () => {
    const invite = await createInvite({ teamId: "t1", role: "admin", maxUses: 5, createdBy: "jo" });
    expect(invite.maxUses).toBe(5);
    expect(invite.role).toBe("admin");
  });
});

describe("getInviteForAcceptance() — status 파생", () => {
  it("없는 토큰 → not_found(토큰 미재노출)", async () => {
    const preview = await getInviteForAcceptance("nope");
    expect(preview.status).toBe("not_found");
    expect(preview).not.toHaveProperty("token");
  });

  it("회수된 초대 → revoked", async () => {
    seedInvite({ token: "tk", teamId: "t1", revokedAt: new Date() });
    expect((await getInviteForAcceptance("tk")).status).toBe("revoked");
  });

  it("만료된 초대 → expired", async () => {
    seedInvite({ token: "tk", teamId: "t1", expiresAt: new Date(Date.now() - HOUR) });
    expect((await getInviteForAcceptance("tk")).status).toBe("expired");
  });

  it("소진된 초대(usedCount≥maxUses) → used_up", async () => {
    seedInvite({ token: "tk", teamId: "t1", maxUses: 2, usedCount: 2 });
    expect((await getInviteForAcceptance("tk")).status).toBe("used_up");
  });

  it("유효한 초대 → ready(팀명·역할 노출, 토큰 미노출)", async () => {
    seedInvite({ token: "tk", teamId: "t1", role: "admin" });
    const preview = await getInviteForAcceptance("tk");
    expect(preview.status).toBe("ready");
    if (preview.status === "ready") {
      expect(preview.teamName).toBe("하박조팽");
      expect(preview.teamSlug).toBe("habakjopaeng");
      expect(preview.role).toBe("admin");
      expect(preview.usedCount).toBe(0);
      expect(preview.maxUses).toBe(1);
    }
    expect(preview).not.toHaveProperty("token");
  });
});

describe("acceptInvite()", () => {
  it("유효 초대로 합류: Membership 생성·usedCount++·usedAt 설정", async () => {
    seedInvite({ token: "tk", teamId: "t1", role: "member" });
    const result = await acceptInvite({ token: "tk", memberId: "new" });
    expect(result).toEqual({ teamSlug: "habakjopaeng", alreadyMember: false });
    expect(db.memberships).toContainEqual({ teamId: "t1", memberId: "new", role: "member" });
    expect(db.acceptances).toHaveLength(1);
    const inv = db.invites[0];
    expect(inv.usedCount).toBe(1);
    expect(inv.usedAt).not.toBeNull();
  });

  it("멱등: 이미 그 팀 멤버면 사용 소모 없이 성공", async () => {
    seedInvite({ token: "tk", teamId: "t1", role: "member" });
    db.memberships.push({ teamId: "t1", memberId: "jo", role: "owner" });
    const result = await acceptInvite({ token: "tk", memberId: "jo" });
    expect(result).toEqual({ teamSlug: "habakjopaeng", alreadyMember: true });
    expect(db.invites[0].usedCount).toBe(0); // 소모 없음
    expect(db.memberships).toHaveLength(1); // 새 멤버십 없음
  });

  it("없는 토큰 → not_found", async () => {
    const e = await caught(acceptInvite({ token: "nope", memberId: "x" }));
    expect(e.code).toBe("not_found");
  });

  it("회수된 초대 → revoked(합류 불가)", async () => {
    seedInvite({ token: "tk", teamId: "t1", revokedAt: new Date() });
    const e = await caught(acceptInvite({ token: "tk", memberId: "x" }));
    expect(e.code).toBe("revoked");
    expect(db.memberships).toHaveLength(0);
  });

  it("만료된 초대 → expired", async () => {
    seedInvite({ token: "tk", teamId: "t1", expiresAt: new Date(Date.now() - HOUR) });
    const e = await caught(acceptInvite({ token: "tk", memberId: "x" }));
    expect(e.code).toBe("expired");
    expect(db.memberships).toHaveLength(0);
  });

  it("소진된 초대 → used_up", async () => {
    seedInvite({ token: "tk", teamId: "t1", maxUses: 1, usedCount: 1 });
    const e = await caught(acceptInvite({ token: "tk", memberId: "x" }));
    expect(e.code).toBe("used_up");
    expect(db.memberships).toHaveLength(0);
  });

  it("race(직렬화): maxUses=1에 동시 수락하면 한 명만 성공, 나머지는 used_up", async () => {
    seedInvite({ token: "tk", teamId: "t1", maxUses: 1, role: "member" });
    const results = await Promise.allSettled([
      acceptInvite({ token: "tk", memberId: "a" }),
      acceptInvite({ token: "tk", memberId: "b" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(HttpError);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe("used_up");
    expect(db.invites[0].usedCount).toBe(1); // 정확히 1회만 소모
    expect(db.memberships).toHaveLength(1);
  });
});
