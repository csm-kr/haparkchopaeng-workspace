import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 전역 앱 설정(ADR-022)의 우선순위 규칙을 prisma 인메모리 목으로 검증한다.
// CRITICAL: 우선순위는 DB > env > 코드 기본 2. row 부재는 "미설정"이지 0이 아니다.

interface SettingRow {
  id: string;
  maxTeams: number | null;
  updatedBy: string | null;
}

const { db } = vi.hoisted(() => ({
  db: { setting: null as SettingRow | null },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        db.setting && db.setting.id === where.id ? db.setting : null,
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: { id: string; maxTeams: number; updatedBy: string };
          update: { maxTeams: number; updatedBy: string };
        }) => {
          if (db.setting && db.setting.id === where.id) {
            db.setting = { ...db.setting, ...update };
          } else {
            db.setting = { id: create.id, maxTeams: create.maxTeams, updatedBy: create.updatedBy };
          }
          return db.setting;
        },
      ),
    },
  },
}));

const { MAX_TEAMS_MAX, MAX_TEAMS_MIN, maxTeams, setMaxTeams } = await import("@/lib/settings");

const ORIGINAL_MAX = process.env.MAX_TEAMS;

beforeEach(() => {
  db.setting = null;
  delete process.env.MAX_TEAMS;
});

afterEach(() => {
  if (ORIGINAL_MAX === undefined) delete process.env.MAX_TEAMS;
  else process.env.MAX_TEAMS = ORIGINAL_MAX;
});

describe("maxTeams()", () => {
  it("DB row도 env도 없으면 기본 2", async () => {
    expect(await maxTeams()).toBe(2);
  });

  it("DB row가 없고 env가 있으면 env 값", async () => {
    process.env.MAX_TEAMS = "5";
    expect(await maxTeams()).toBe(5);
  });

  it("DB row가 있으면 env를 무시하고 DB 값", async () => {
    process.env.MAX_TEAMS = "5";
    db.setting = { id: "singleton", maxTeams: 7, updatedBy: "ha" };
    expect(await maxTeams()).toBe(7);
  });

  it("DB row는 있지만 maxTeams가 null이면 env로 폴백", async () => {
    process.env.MAX_TEAMS = "4";
    db.setting = { id: "singleton", maxTeams: null, updatedBy: "ha" };
    expect(await maxTeams()).toBe(4);
  });

  it("env가 잘못된 값이면 기본 2로 폴백", async () => {
    process.env.MAX_TEAMS = "abc";
    expect(await maxTeams()).toBe(2);
  });

  it("호출 시점에 env를 읽는다(R2)", async () => {
    process.env.MAX_TEAMS = "3";
    expect(await maxTeams()).toBe(3);
    process.env.MAX_TEAMS = "6";
    expect(await maxTeams()).toBe(6);
  });
});

describe("setMaxTeams()", () => {
  it("row가 없으면 새로 만든다", async () => {
    await setMaxTeams(9, "ha");
    expect(db.setting).toMatchObject({ id: "singleton", maxTeams: 9, updatedBy: "ha" });
    expect(await maxTeams()).toBe(9);
  });

  it("이미 있으면 덮어쓴다(멱등)", async () => {
    await setMaxTeams(9, "ha");
    await setMaxTeams(4, "bak");
    expect(db.setting).toMatchObject({ maxTeams: 4, updatedBy: "bak" });
  });
});

describe("범위 상수", () => {
  it("1–100", () => {
    expect(MAX_TEAMS_MIN).toBe(1);
    expect(MAX_TEAMS_MAX).toBe(100);
  });
});
