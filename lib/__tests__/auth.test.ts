import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// next/headers의 cookies()와 prisma를 인메모리로 목킹해 세션 왕복·역할 가드를 검증한다.
// (cookies()는 요청 컨텍스트가 필요하므로 단위 테스트에서는 목킹한다.)
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

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
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "ha" ? { id: "ha", role: "관리자" } : null,
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
} from "@/lib/auth";
import { HttpError } from "@/lib/http";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-auth-secret";
});

beforeEach(() => {
  store.clear();
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
