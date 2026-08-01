import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// next/headers의 cookies()와 prisma를 인메모리로 목킹해 세션 왕복·역할 가드를 검증한다.
// (cookies()는 요청 컨텍스트가 필요하므로 단위 테스트에서는 목킹한다.)
const { members, store } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  members: new Map<string, { id: string; role: string; email: string }>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => (store.has(key) ? { value: store.get(key) } : undefined),
    set: (key: string, value: string) => {
      store.set(key, value);
    },
    delete: (key: string) => {
      store.delete(key);
    },
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => members.get(where.id) ?? null,
      ),
    },
  },
}));

import {
  createSession,
  destroySession,
  getSession,
  requireAuth,
  requireRole,
  requireSuperAdmin,
} from "@/lib/auth";
import { HttpError } from "@/lib/http";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-auth-secret";
});

beforeEach(() => {
  store.clear();
  members.clear();
  members.set("ha", { id: "ha", role: "관리자", email: "de8167@gmail.com" });
});

describe("session round-trip", () => {
  it("createSession → getSession returns { memberId, role } from DB role", async () => {
    await createSession("ha");
    await expect(getSession()).resolves.toEqual({ memberId: "ha", role: "관리자" });
  });

  it("getSession is null without a cookie", async () => {
    await expect(getSession()).resolves.toBeNull();
  });

  it("destroySession clears the session", async () => {
    await createSession("ha");
    await destroySession();
    await expect(getSession()).resolves.toBeNull();
  });

  it("createSession refuses an unknown member", async () => {
    await expect(createSession("ghost")).rejects.toBeInstanceOf(HttpError);
  });
});

describe("requireAuth / requireRole", () => {
  it("requireAuth throws 401 when unauthenticated", async () => {
    await expect(requireAuth()).rejects.toMatchObject({ status: 401 });
  });

  it("requireRole allows a matching role", async () => {
    await createSession("ha"); // 관리자
    await expect(requireRole("관리자")).resolves.toEqual({ memberId: "ha", role: "관리자" });
  });

  it("requireRole throws 403 when the role is not allowed", async () => {
    await createSession("ha"); // 관리자
    await expect(requireRole("게스트")).rejects.toMatchObject({ status: 403 });
  });
});

// 관리자 콘솔(/admin) 게이트 — Member.role이 아니라 ADMIN_EMAIL 일치로 판정한다(ADR-024).
// CRITICAL: 실패는 403이 아니라 404 — 콘솔의 존재 자체를 숨긴다.
describe("requireSuperAdmin()", () => {
  const ORIGINAL_ADMIN = process.env.ADMIN_EMAIL;

  afterEach(() => {
    if (ORIGINAL_ADMIN === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = ORIGINAL_ADMIN;
  });

  it("ADMIN_EMAIL과 Member.email이 같으면 통과한다", async () => {
    process.env.ADMIN_EMAIL = "de8167@gmail.com";
    await createSession("ha");
    await expect(requireSuperAdmin()).resolves.toEqual({ memberId: "ha", role: "관리자" });
  });

  it("대소문자·공백 차이는 무시한다", async () => {
    process.env.ADMIN_EMAIL = "  DE8167@Gmail.com ";
    await createSession("ha");
    await expect(requireSuperAdmin()).resolves.toMatchObject({ memberId: "ha" });
  });

  it("이메일이 다르면 404를 던진다(403 아님 — 존재 은닉)", async () => {
    process.env.ADMIN_EMAIL = "de8167@gmail.com";
    members.set("bak", { id: "bak", role: "멤버", email: "someone@else.com" });
    await createSession("bak");
    const e = await requireSuperAdmin().catch((err) => err);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(404);
    expect(e.code).toBe("NOT_FOUND");
  });

  it("role이 관리자여도 이메일이 다르면 막는다", async () => {
    process.env.ADMIN_EMAIL = "de8167@gmail.com";
    members.set("jo", { id: "jo", role: "관리자", email: "jo@habakjopaeng.team" });
    await createSession("jo");
    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(HttpError);
  });

  it("미인증이면 404를 던진다", async () => {
    process.env.ADMIN_EMAIL = "de8167@gmail.com";
    const e = await requireSuperAdmin().catch((err) => err);
    expect(e.status).toBe(404);
  });

  it("ADMIN_EMAIL 미설정이면 기본값 de8167@gmail.com을 쓴다", async () => {
    delete process.env.ADMIN_EMAIL;
    await createSession("ha");
    await expect(requireSuperAdmin()).resolves.toMatchObject({ memberId: "ha" });
  });
});
