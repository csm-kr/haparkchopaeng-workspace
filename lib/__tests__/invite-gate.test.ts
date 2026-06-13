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

import { gateInvitedEmail } from "@/lib/invite-gate";

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

  it("비초대 이메일은 거부한다(합류·세션 금지)", async () => {
    const result = await gateInvitedEmail("stranger@evil.com");
    expect(result).toEqual({ ok: false, reason: "NOT_INVITED" });
    expect(db.members.size).toBe(0); // Member를 만들지 않는다(R18)
  });

  it("pending 초대가 있으면 Member를 생성하고 초대를 수락 처리한다", async () => {
    db.invites.set("inv1", {
      id: "inv1",
      email: "new@uni.ac.kr",
      role: "멤버",
      status: "pending",
    });
    const result = await gateInvitedEmail("new@uni.ac.kr");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.member.email).toBe("new@uni.ac.kr");
      expect(result.member.role).toBe("멤버"); // 역할은 초대에서(클라 미신뢰)
    }
    expect(db.invites.get("inv1")?.status).toBe("accepted"); // 1회성 소비
    expect(db.members.size).toBe(1);
  });

  it("pending이 아닌 초대(이미 수락/취소)는 거부한다", async () => {
    db.invites.set("inv2", {
      id: "inv2",
      email: "used@uni.ac.kr",
      role: "멤버",
      status: "accepted",
    });
    const result = await gateInvitedEmail("used@uni.ac.kr");
    expect(result).toEqual({ ok: false, reason: "NOT_INVITED" });
    expect(db.members.size).toBe(0);
  });
});
