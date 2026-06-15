import { beforeEach, describe, expect, it, vi } from "vitest";

// 활성 팀 해소(ADR-020/R37) — next/headers 쿠키 + prisma 인메모리 목으로 검증한다.
// CRITICAL: 쿠키 값은 멤버십 검증 후에만 신뢰한다(R3/R19). 무효/미설정이면 resolveEntryTeam(최근 합류)로 폴백.
// 도메인 쿼리 스코핑은 이 step 범위 밖 — 여기선 활성 팀 해소까지만.

interface TeamRow {
  id: string;
  slug: string;
  name: string;
}
interface MembershipRow {
  teamId: string;
  memberId: string;
  role: string;
  joinedAt: number;
}

const { db, cookieStore } = vi.hoisted(() => ({
  db: { teams: [] as TeamRow[], memberships: [] as MembershipRow[] },
  cookieStore: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (cookieStore.has(k) ? { value: cookieStore.get(k) } : undefined),
    set: (k: string, v: string) => {
      cookieStore.set(k, v);
    },
    delete: (k: string) => {
      cookieStore.delete(k);
    },
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    team: {
      findUnique: vi.fn(async ({ where }: { where: { slug?: string; id?: string } }) => {
        return (
          db.teams.find(
            (t) =>
              (where.slug !== undefined && t.slug === where.slug) ||
              (where.id !== undefined && t.id === where.id),
          ) ?? null
        );
      }),
    },
    membership: {
      findUnique: vi.fn(
        async ({ where }: { where: { teamId_memberId: { teamId: string; memberId: string } } }) => {
          const { teamId, memberId } = where.teamId_memberId;
          return db.memberships.find((m) => m.teamId === teamId && m.memberId === memberId) ?? null;
        },
      ),
      findFirst: vi.fn(
        async ({
          where,
          include,
        }: {
          where: { memberId: string };
          orderBy?: unknown;
          include?: { team?: boolean };
        }) => {
          const rows = db.memberships
            .filter((m) => m.memberId === where.memberId)
            .slice()
            .sort((a, b) => b.joinedAt - a.joinedAt);
          const row = rows[0];
          if (!row) return null;
          if (include?.team) return { ...row, team: db.teams.find((t) => t.id === row.teamId) ?? null };
          return row;
        },
      ),
    },
  },
}));

import { HttpError } from "@/lib/http";
import { getActiveTeam, getActiveTeamSlug, setActiveTeam } from "@/lib/active-team";

const COOKIE = "active_team";

beforeEach(() => {
  // ha: alpha(owner)·beta(admin) — beta가 최근. bak: alpha(member)·gamma(owner). ha는 gamma 비멤버.
  db.teams = [
    { id: "t1", slug: "alpha", name: "알파" },
    { id: "t2", slug: "beta", name: "베타" },
    { id: "t3", slug: "gamma", name: "감마" },
  ];
  db.memberships = [
    { teamId: "t1", memberId: "ha", role: "owner", joinedAt: 1 },
    { teamId: "t1", memberId: "bak", role: "member", joinedAt: 2 },
    { teamId: "t2", memberId: "ha", role: "admin", joinedAt: 3 },
    { teamId: "t3", memberId: "bak", role: "owner", joinedAt: 4 },
  ];
  cookieStore.clear();
});

describe("getActiveTeamSlug()", () => {
  it("쿠키가 내 멤버십이면 그 팀을 활성으로", async () => {
    cookieStore.set(COOKIE, "alpha");
    expect(await getActiveTeamSlug("ha")).toBe("alpha");
  });

  it("쿠키가 내 멤버십이 아니면 무시하고 resolveEntryTeam(최근 합류)으로 폴백", async () => {
    cookieStore.set(COOKIE, "gamma"); // ha는 gamma 비멤버
    expect(await getActiveTeamSlug("ha")).toBe("beta");
  });

  it("쿠키 slug가 존재하지 않는 팀이어도 폴백", async () => {
    cookieStore.set(COOKIE, "ghost-team");
    expect(await getActiveTeamSlug("ha")).toBe("beta");
  });

  it("쿠키가 없으면 최근 합류 팀", async () => {
    expect(await getActiveTeamSlug("ha")).toBe("beta");
  });

  it("팀이 0개면 null", async () => {
    expect(await getActiveTeamSlug("ghost")).toBeNull();
  });
});

describe("getActiveTeam()", () => {
  it("쿠키가 유효하면 { id, slug, role } 해소", async () => {
    cookieStore.set(COOKIE, "alpha");
    expect(await getActiveTeam("ha")).toEqual({ id: "t1", slug: "alpha", role: "owner" });
  });

  it("쿠키 없으면 최근 합류 팀으로 해소", async () => {
    expect(await getActiveTeam("ha")).toEqual({ id: "t2", slug: "beta", role: "admin" });
  });

  it("팀이 0개면 null", async () => {
    expect(await getActiveTeam("ghost")).toBeNull();
  });
});

describe("setActiveTeam()", () => {
  it("내 멤버십이면 쿠키를 설정한다", async () => {
    await setActiveTeam("ha", "alpha");
    expect(cookieStore.get(COOKIE)).toBe("alpha");
    // 설정 후 해소가 그 팀을 가리킨다.
    expect(await getActiveTeamSlug("ha")).toBe("alpha");
  });

  it("내 멤버십이 아니면 거부(403)하고 쿠키를 설정하지 않는다", async () => {
    const e = await setActiveTeam("ha", "gamma").catch((err) => err);
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(403);
    expect(cookieStore.has(COOKIE)).toBe(false);
  });

  it("존재하지 않는 팀 slug도 거부(403)", async () => {
    await expect(setActiveTeam("ha", "ghost-team")).rejects.toBeInstanceOf(HttpError);
    expect(cookieStore.has(COOKIE)).toBe(false);
  });
});
