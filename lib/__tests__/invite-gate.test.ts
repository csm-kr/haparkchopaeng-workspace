import { beforeEach, describe, expect, it, vi } from "vitest";

// 초대 게이트 로직을 prisma 인메모리 목으로 검증한다(Supabase는 신원만, 여기선 모킹 불필요).
// 검증: 비초대 거부 · 멤버 통과 · 초대 수락(이메일→Member 매핑) (ADR-017/R18).

const { db } = vi.hoisted(() => ({
  db: {
    members: new Map<string, { id: string; name: string; email: string; role: string }>(),
    invites: new Map<string, { id: string; email: string; role: string; status: string }>(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => {
        for (const m of db.members.values()) if (m.email === where.email) return m;
        return null;
      }),
      create: vi.fn(
        async ({ data }: { data: { id: string; name: string; email: string; role: string } }) => {
          db.members.set(data.id, data);
          return data;
        },
      ),
    },
    invite: {
      findFirst: vi.fn(
        async ({ where }: { where: { email: string; status: string } }) => {
          for (const i of db.invites.values()) {
            if (i.email === where.email && i.status === where.status) return i;
          }
          return null;
        },
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        member: {
          create: vi.fn(async ({ data }: { data: { id: string; name: string; email: string; role: string } }) => {
            db.members.set(data.id, data);
            return data;
          }),
        },
        invite: {
          update: vi.fn(
            async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
              const inv = db.invites.get(where.id);
              if (inv) inv.status = data.status;
              return inv;
            },
          ),
        },
      };
      return fn(tx);
    }),
  },
}));

import { findOrCreateMember, gateInvitedEmail } from "@/lib/invite-gate";

beforeEach(() => {
  db.members.clear();
  db.invites.clear();
});

describe("gateInvitedEmail (초대 게이트)", () => {
  it("이미 합류한 멤버는 통과한다(이메일 매핑)", async () => {
    db.members.set("ha", { id: "ha", name: "하수현", email: "ha@uni.ac.kr", role: "관리자" });
    const result = await gateInvitedEmail("ha@uni.ac.kr");
    expect(result).toEqual({
      ok: true,
      member: { id: "ha", name: "하수현", email: "ha@uni.ac.kr", role: "관리자" },
    });
  });

  it("멤버가 아닌 이메일은 NOT_INVITED(레거시 게이트 — 이메일 초대 경로는 ADR-018로 폐기)", async () => {
    const result = await gateInvitedEmail("stranger@evil.com");
    expect(result).toEqual({ ok: false, reason: "NOT_INVITED" });
    expect(db.members.size).toBe(0); // 게이트는 Member를 만들지 않는다
  });
});

describe("findOrCreateMember (멀티팀 — 로그인은 누구나, ADR-018)", () => {
  it("이미 있는 멤버는 그대로 반환한다(생성하지 않음)", async () => {
    db.members.set("ha", { id: "ha", name: "하수현", email: "ha@uni.ac.kr", role: "관리자" });
    const member = await findOrCreateMember("ha@uni.ac.kr");
    expect(member.id).toBe("ha");
    expect(db.members.size).toBe(1); // 새로 만들지 않는다
  });

  it("없으면 거부하지 않고 생성한다(이름=local-part, 기본 역할 멤버)", async () => {
    const member = await findOrCreateMember("stranger@evil.com");
    expect(member.email).toBe("stranger@evil.com");
    expect(member.name).toBe("stranger"); // local-part
    expect(member.role).toBe("멤버"); // 기본 역할
    expect(db.members.size).toBe(1);
  });
});
