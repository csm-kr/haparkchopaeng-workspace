import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 팀 생성 도메인(ADR-018/R18·R19)을 prisma 인메모리 목으로 검증한다.
// 검증: 전역 상한(MAX_TEAMS) · slug 충돌 회피 · 생성자=owner 멤버십 · 역할 헬퍼 · 진입 해소.
// CRITICAL: 권한은 RLS 없이 앱레벨, creatorId는 세션에서(여기선 인자) — route/action 단은 별도.

interface TeamRow {
  id: string;
  slug: string;
  name: string;
  createdBy: string;
  createdAt: Date;
}
interface MembershipRow {
  teamId: string;
  memberId: string;
  role: string;
  joinedAt: Date;
}

const { db } = vi.hoisted(() => ({
  db: {
    teams: new Map<string, TeamRow>(),
    memberships: [] as MembershipRow[],
    seq: { team: 0, time: 0 },
  },
}));

vi.mock("@/lib/prisma", () => {
  const team = {
    count: vi.fn(async () => db.teams.size),
    findUnique: vi.fn(async ({ where }: { where: { slug?: string; id?: string } }) => {
      for (const t of db.teams.values()) {
        if (where.slug !== undefined && t.slug === where.slug) return t;
        if (where.id !== undefined && t.id === where.id) return t;
      }
      return null;
    }),
    create: vi.fn(
      async ({ data }: { data: { slug: string; name: string; createdBy: string } }) => {
        const id = `t${++db.seq.team}`;
        const row: TeamRow = {
          id,
          slug: data.slug,
          name: data.name,
          createdBy: data.createdBy,
          createdAt: new Date(++db.seq.time),
        };
        db.teams.set(id, row);
        return row;
      },
    ),
  };
  const membership = {
    create: vi.fn(
      async ({ data }: { data: { teamId: string; memberId: string; role: string } }) => {
        const row: MembershipRow = {
          teamId: data.teamId,
          memberId: data.memberId,
          role: data.role,
          joinedAt: new Date(++db.seq.time),
        };
        db.memberships.push(row);
        return row;
      },
    ),
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
          .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime());
        const row = rows[0];
        if (!row) return null;
        if (include?.team) return { ...row, team: db.teams.get(row.teamId) ?? null };
        return row;
      },
    ),
  };
  return {
    prisma: {
      team,
      membership,
      // 트랜잭션 내 델리게이트는 동일 인메모리 store를 공유한다(부분 실패/재확인 검증용).
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ team, membership })),
    },
  };
});

import { HttpError } from "@/lib/http";
import {
  createTeam,
  getMembership,
  isTeamAdmin,
  isTeamMember,
  isTeamOwner,
  maxTeams,
  resolveEntryTeam,
} from "@/lib/teams";

const ORIGINAL_MAX = process.env.MAX_TEAMS;

beforeEach(() => {
  db.teams.clear();
  db.memberships.length = 0;
  db.seq.team = 0;
  db.seq.time = 0;
  process.env.MAX_TEAMS = "10"; // 대부분 테스트는 상한과 무관 — 별도 테스트에서 덮어쓴다.
});

afterEach(() => {
  if (ORIGINAL_MAX === undefined) delete process.env.MAX_TEAMS;
  else process.env.MAX_TEAMS = ORIGINAL_MAX;
});

async function caught(p: Promise<unknown>): Promise<HttpError> {
  const e = await p.catch((err) => err);
  expect(e).toBeInstanceOf(HttpError);
  return e as HttpError;
}

describe("maxTeams()", () => {
  it("미설정이면 기본 2", () => {
    delete process.env.MAX_TEAMS;
    expect(maxTeams()).toBe(2);
  });

  it("호출 시점에 env를 읽는다", () => {
    process.env.MAX_TEAMS = "5";
    expect(maxTeams()).toBe(5);
    process.env.MAX_TEAMS = "3";
    expect(maxTeams()).toBe(3);
  });

  it("잘못된 값이면 기본 2로 폴백", () => {
    process.env.MAX_TEAMS = "abc";
    expect(maxTeams()).toBe(2);
  });
});

describe("createTeam()", () => {
  it("상한 미만이면 생성한다(slug 자동 생성)", async () => {
    const t = await createTeam({ name: "Robotics Lab", creatorId: "ha" });
    expect(t.slug).toBe("robotics-lab");
    expect(db.teams.size).toBe(1);
  });

  it("생성자는 owner 멤버십으로 들어간다(owner ≥ 1)", async () => {
    const t = await createTeam({ name: "Vision Group", creatorId: "bak" });
    const m = db.memberships.find((x) => x.teamId === t.id && x.memberId === "bak");
    expect(m?.role).toBe("owner");
  });

  it("전역 상한(MAX_TEAMS=2)을 초과하면 TEAM_LIMIT(403)", async () => {
    process.env.MAX_TEAMS = "2";
    await createTeam({ name: "Team One", creatorId: "ha" });
    await createTeam({ name: "Team Two", creatorId: "bak" });
    const e = await caught(createTeam({ name: "Team Three", creatorId: "jo" }));
    expect(e.status).toBe(403);
    expect(e.code).toBe("TEAM_LIMIT");
    expect(db.teams.size).toBe(2); // 3번째는 생성되지 않는다.
  });

  it("slug 자동 생성이 충돌하면 -2, -3으로 회피한다", async () => {
    const a = await createTeam({ name: "Same Name", creatorId: "ha" });
    const b = await createTeam({ name: "Same Name", creatorId: "bak" });
    expect(a.slug).toBe("same-name");
    expect(b.slug).toBe("same-name-2");
  });

  it("명시한 slug가 중복이면 SLUG_TAKEN(409)", async () => {
    await createTeam({ name: "Alpha", slug: "alpha", creatorId: "ha" });
    const e = await caught(createTeam({ name: "Another", slug: "alpha", creatorId: "bak" }));
    expect(e.status).toBe(409);
    expect(e.code).toBe("SLUG_TAKEN");
  });

  it("이름이 2자 미만/30자 초과면 거부(400)", async () => {
    const e1 = await caught(createTeam({ name: "A", creatorId: "ha" }));
    expect(e1.status).toBe(400);
    const e2 = await caught(createTeam({ name: "x".repeat(31), creatorId: "ha" }));
    expect(e2.status).toBe(400);
    expect(db.teams.size).toBe(0);
  });

  it("명시 slug가 형식에 안 맞으면 거부(400)", async () => {
    const e = await caught(createTeam({ name: "Alpha", slug: "1bad", creatorId: "ha" }));
    expect(e.status).toBe(400);
  });
});

describe("역할 헬퍼", () => {
  it("getMembership은 멤버십이 있으면 role을, 없으면 null", async () => {
    const t = await createTeam({ name: "Crew", creatorId: "ha" });
    expect(await getMembership(t.id, "ha")).toEqual({ role: "owner" });
    expect(await getMembership(t.id, "bak")).toBeNull();
  });

  it("isTeamMember/isTeamAdmin/isTeamOwner 위계(owner>admin>member)", async () => {
    const t = await createTeam({ name: "Crew", creatorId: "ha" });
    db.memberships.push({
      teamId: t.id,
      memberId: "bak",
      role: "admin",
      joinedAt: new Date(++db.seq.time),
    });
    db.memberships.push({
      teamId: t.id,
      memberId: "jo",
      role: "member",
      joinedAt: new Date(++db.seq.time),
    });

    expect(await isTeamOwner(t.id, "ha")).toBe(true);
    expect(await isTeamOwner(t.id, "bak")).toBe(false);

    expect(await isTeamAdmin(t.id, "ha")).toBe(true); // owner는 admin 권한 포함
    expect(await isTeamAdmin(t.id, "bak")).toBe(true);
    expect(await isTeamAdmin(t.id, "jo")).toBe(false);

    expect(await isTeamMember(t.id, "jo")).toBe(true);
    expect(await isTeamMember(t.id, "nobody")).toBe(false);
  });
});

describe("resolveEntryTeam()", () => {
  it("멤버십이 없으면 null(= 팀 없음)", async () => {
    expect(await resolveEntryTeam("ghost")).toBeNull();
  });

  it("가장 최근 joinedAt 팀의 slug를 돌려준다", async () => {
    await createTeam({ name: "First", creatorId: "ha" });
    const second = await createTeam({ name: "Second", creatorId: "ha" });
    expect(await resolveEntryTeam("ha")).toEqual({ slug: second.slug });
  });
});
